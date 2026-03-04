'use server';
/**
 * @fileOverview This file implements a Genkit flow for diagnosing bidding performance issues.
 * It handles multi-campaign sequential logic where a catalog may belong to multiple campaigns.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import {
  DiagnoseBiddingInputSchema,
  DiagnoseBiddingInput,
  DiagnoseBiddingOutputSchema,
  DiagnoseBiddingOutput,
  AnalysisTypeSchema,
  BiddingDataRowSchema
} from './diagnose-bidding-performance.schema';
import { parseBiddingCsv } from '@/lib/csv-utils';
import { initializeFirebase } from '@/firebase';
import { doc, setDoc } from 'firebase/firestore';

const LLMPromptInputSchema = z.object({
  analysisType: AnalysisTypeSchema,
  catalogDataJson: z
    .string()
    .describe('JSON string of time-bucket level data for a single catalog. May contain multiple campaigns.'),
  catalog_id: z
    .string()
    .describe('The ID of the catalog for which the data is provided.'),
  pUp: z.number().describe('The P_up constant used in the system.'),
  pDown: z.number().describe('The P_down constant used in the system.'),
  nWindow: z.number().describe('The window size N for ROI stability.'),
  kTrigger: z.number().describe('The trigger K for update frequency.'),
});

const diagnoseBiddingPrompt = ai.definePrompt({
  name: 'diagnoseBiddingPrompt',
  input: { schema: LLMPromptInputSchema },
  output: { schema: DiagnoseBiddingOutputSchema },
  system: `You are a senior Ads Bidding PM and Data Scientist. You are diagnosing a bidding control system that regulates performance by adjusting the **ROI Target**.

CORE CONTROL LOGIC:
1. Bid Formula: Bid = pCVR * (AOV / ROI_Target).
2. ROI Target Dynamics:
   - ROI Pacing to increase spending: When Catalog_ROI > SL_ROI and BU < BU Ideal, REDUCE ROI_Target.
   - ROI Pacing to protect delivery (Protection Side): When Catalog_ROI < SL_ROI, INCREASE ROI_Target to protect margins.
   - Budget Pacing to reduce spending: When Catalog_ROI > SL_ROI and BU > BU Ideal, INCREASE ROI_Target.
3. Reliability Window (N): ROI stability for Catalog_ROI is calculated over N = {{{nWindow}}} clicks.
4. Update Trigger (K): ROI_Target is updated every K = {{{kTrigger}}} clicks.
5. Asymmetric Sensitivity: P_down ({{{pDown}}}) reacts fast to protect ROI; P_up ({{{pUp}}}) reacts slowly to scale spend.

MULTI-CAMPAIGN & CLICK VOLUME ANALYSIS:
- A single Catalog ID may be part of multiple campaigns running SEQUENTIALLY.
- **CRITICAL**: You MUST sum up clicks across ALL campaigns for the catalog to determine total daily volume.
- **DO NOT** diagnose "low click volume" if the AGGREGATE catalog clicks for the day meet or exceed the K-trigger ({{{kTrigger}}}).

DIAGNOSIS GUIDELINES:
- For "Low BU Analysis":
    * CONFIRMATION: Only confirm the issue if "Catalog BU%" is consistently low at the END OF THE DAY (final buckets).
    * ROOT CAUSES (L1):
        - Slow ROI Pacing: ROI Target is high and moving slowly.
        - Fast Budget Pacing: ROI target increased too rapidly to curb spend.
        - Fast ROI Pacing (protection side): High spike in ROI Target during a low-ROI period.
            * L2 DRIVERS: 
              a) Significant SL ROI increase by the seller (check if SL ROI jumped significantly, causing a high error in the control loop).
              b) Unstable Catalog ROI because the window N ({{{nWindow}}}) is too small for the volatility, leading to "false" protection triggers.
        - Incorrect Catalog ROI Window: Large N causes lag. Day ROI is high, but Catalog ROI (windowed) remains low, causing incorrect target increases.
        - Catalog/Campaign Status: Check for "paused" or "inactive" status in the data.
        - Outlier days: Spends behaved differently than they usually do because of sale or any other click mix change reason, leading to low ROI on the day. This leads to a drop in Catalog ROI, leading to an increase in ROI target over multiple days. A high ROI target can also result in low clicks and low ROI as we’re not exploring enough. This in turn puts the catalog in a low clicks and low ROI loop.
    * L2 REASONING: Identify the underlying driver causing the L1 behavior. Do NOT repeat L1.
    * SEVERITY: "High" only if end-of-day Low BU persists across multiple days.
    * EVIDENCE: Use SL ROI and ROI Target terms. DO NOT mention alpha. Reference AGGREGATE daily clicks to justify volume claims.`,
  prompt: `Analysis Type: {{{analysisType}}}
Constants: P_up = {{{pUp}}}, P_down = {{{pDown}}}, N = {{{nWindow}}}, K = {{{kTrigger}}}

Catalog Data (sorted by timestamp):
{{{catalogDataJson}}}

Tasks:
1. Confirm validity based on EOD BU% trends and multi-campaign sequential flow.
2. Identify Root Cause (L1).
3. Identify L2 Reason: Focus on SL ROI spikes or window stability if protection side was triggered.
4. Evidence: Use SL ROI and ROI Target terms. Reference AGGREGATE daily clicks.
5. Recommend a fix (e.g., "Decrease P_down", "Increase P_up", "Increase N").
6. Justify Severity at the catalog level based on persistency.

Return JSON matching the schema.`,
});

export async function fetchCsvFromUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to fetch data from Storage.");
  const csvText = await response.text();
  return parseBiddingCsv(csvText);
}

export async function diagnoseBiddingPerformance(
  input: DiagnoseBiddingInput & { fileUrl?: string; pUp?: number; pDown?: number; sessionId?: string }
): Promise<DiagnoseBiddingOutput[]> {
  let biddingData = input.biddingData;

  // If a file URL is provided, we fetch the data on the server to avoid large body payloads
  if (input.fileUrl) {
    biddingData = await fetchCsvFromUrl(input.fileUrl);
  }

  if (!biddingData || biddingData.length === 0) {
    throw new Error("No bidding data provided for analysis.");
  }

  const {analysisType, nWindow = 1800, kTrigger = 360, sessionId} = input;
  const { firestore } = initializeFirebase();
  
  // Group data by catalog ID
  const catalogDataMap = new Map<string, z.infer<typeof BiddingDataRowSchema>[]>();
  for (const row of biddingData) {
    if (!row.catalog_id) continue;
    if (!catalogDataMap.has(row.catalog_id)) {
      catalogDataMap.set(row.catalog_id, []);
    }
    catalogDataMap.get(row.catalog_id)?.push(row);
  }

  // Take a representative sample to avoid extreme batch durations
  const catalogIds = Array.from(catalogDataMap.keys()).slice(0, 15);
  const pUp = biddingData[0]?.p_up ?? input.pUp ?? 0.1;
  const pDown = biddingData[0]?.p_down ?? input.pDown ?? 0.2;

  const validResults: DiagnoseBiddingOutput[] = [];

  // SEQUENTIAL PROCESSING ON BACKEND with internal retry logic for quotas
  for (const catalogId of catalogIds) {
    const catalogRows = catalogDataMap.get(catalogId)!;
    const sortedData = [...catalogRows].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    let retryCount = 0;
    let success = false;
    
    while (retryCount < 3 && !success) {
      try {
        const {output} = await diagnoseBiddingPrompt({
          analysisType,
          catalogDataJson: JSON.stringify(sortedData, null, 2),
          catalog_id: catalogId,
          pUp,
          pDown,
          nWindow,
          kTrigger,
        });

        if (output) {
          const result = { ...output, catalog_id: catalogId };
          validResults.push(result);
          
          // INCREMENTAL STORAGE: Save to Firestore immediately
          if (sessionId && firestore) {
            const resRef = doc(firestore, 'analysis_sessions', sessionId, 'results', catalogId);
            setDoc(resRef, { ...result, timestamp: new Date().toISOString() }).catch(e => {
               // Silently catch permission errors to not break the batch
            });
          }
          
          success = true;
        }
      } catch (err: any) {
        if (err.message.includes('429') || err.message.includes('Quota')) {
          retryCount++;
          if (retryCount < 3) {
            // Wait with exponential backoff (4s, 8s, 16s)
            await new Promise(r => setTimeout(r, Math.pow(2, retryCount) * 4000));
          }
        } else {
          break;
        }
      }
    }
    
    // Safety delay between catalogs to prevent burst quota hits
    await new Promise(r => setTimeout(r, 1500));
  }

  return validResults;
}
