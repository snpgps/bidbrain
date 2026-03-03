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
  input: DiagnoseBiddingInput & { fileUrl?: string }
): Promise<DiagnoseBiddingOutput[]> {
  let biddingData = input.biddingData;

  if (input.fileUrl) {
    biddingData = await fetchCsvFromUrl(input.fileUrl);
  }

  if (!biddingData || biddingData.length === 0) {
    throw new Error("No bidding data provided for analysis.");
  }

  const {analysisType, nWindow = 1800, kTrigger = 360} = input;
  const today = new Date().toISOString().split('T')[0];
  const historicalData = biddingData.filter(row => !row.timestamp.startsWith(today));

  if (historicalData.length === 0) {
    throw new Error("No complete historical days found in data.");
  }

  const catalogDataMap = new Map<string, z.infer<typeof BiddingDataRowSchema>[]>();
  for (const row of historicalData) {
    if (!catalogDataMap.has(row.catalog_id)) {
      catalogDataMap.set(row.catalog_id, []);
    }
    catalogDataMap.get(row.catalog_id)?.push(row);
  }

  const catalogIds = Array.from(catalogDataMap.keys()).slice(0, 20);
  const pUp = biddingData[0]?.p_up ?? input.pUp ?? 0.1;
  const pDown = biddingData[0]?.p_down ?? input.pDown ?? 0.2;

  const diagnosticPromises = catalogIds.map(async (catalogId) => {
    const catalogRows = catalogDataMap.get(catalogId)!;
    const sortedData = [...catalogRows].sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

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

      if (!output) return null;
      return { ...output, catalog_id: catalogId };
    } catch (error: any) {
      throw new Error(`AI Diagnostic Error for Catalog ${catalogId}: ${error.message}`);
    }
  });

  const results = await Promise.all(diagnosticPromises);
  const validResults = results.filter((res): res is DiagnoseBiddingOutput => res !== null);

  if (validResults.length === 0) {
    throw new Error("Analysis completed but no valid insights were generated.");
  }

  return validResults;
}
