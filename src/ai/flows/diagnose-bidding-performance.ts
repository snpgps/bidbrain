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
   - ROI Pacing to protect delivery: When Catalog_ROI < SL_ROI, INCREASE ROI_Target.
   - Budget Pacing to reduce spending: When Catalog_ROI > SL_ROI and BU > BU Ideal, INCREASE ROI_Target.
3. Reliability Window (N): ROI stability for Catalog_ROI is calculated over N = {{{nWindow}}} clicks.
4. Update Trigger (K): ROI_Target is updated every K = {{{kTrigger}}} clicks.
5. Asymmetric Sensitivity: P_down ({{{pDown}}}) reacts fast to protect ROI; P_up ({{{pUp}}}) reacts slowly to scale spend.

MULTI-CAMPAIGN & CLICK VOLUME ANALYSIS:
- A single Catalog ID may be part of multiple campaigns running SEQUENTIALLY.
- **CRITICAL**: You MUST sum up clicks across ALL campaigns for the catalog to determine the total daily volume.
- Check the final daily buckets to see total cumulative clicks for the catalog.
- **DO NOT** diagnose "low click volume" if the aggregate catalog clicks for the day meet or exceed the K-trigger ({{{kTrigger}}}).
- If daily clicks are high (e.g., >2*K), "Slow ROI Pacing" cannot be blamed on volume; look for system-induced suppression or parameter lag instead.

DIAGNOSIS GUIDELINES:
- For "Low BU Analysis":
    * CONFIRMATION: Only confirm the issue if "Catalog BU%" is consistently low at the END OF THE DAY (summing spend across campaigns). Say there is no problem if aggregate BU is consistently above 80% at EOD.
    * ROOT CAUSES:
        - Slow ROI Pacing: ROI Target is high and moving slowly. Only blame "low click volume" if the AGGREGATE daily clicks are below K. If clicks are high, investigate if P_up is too small or if previous day suppression is the cause.
        - Fast Budget Pacing: ROI target increased too rapidly. Note: System resets ROI target daily unless Catalog ROI was in 1-1.2 range at EOD.
        - Fast ROI Pacing (protection side): High spike in ROI Target during a low-ROI period, leading to suppressed spending.
        - Incorrect Catalog ROI Window: Large N causes lag. Day ROI might be high, but Catalog ROI (windowed) remains low, causing incorrect target increases.
        - Catalog/Campaign Status: Check if "status" columns show "paused" or "inactive".
    * L1 vs L2 REASONING:
        - L1 (What): The technical mechanism (e.g., "Slow ROI Pacing").
        - L2 (Why): The underlying driver. MUST NOT repeat L1. If L1 is "Slow ROI Pacing", L2 should explain if it's due to "Prior day ROI crash" or "Multi-campaign transition gap".
    * SEVERITY: "High" only if aggregate end-of-day Low BU persists across multiple days.
    * SEVERITY JUSTIFICATION: Exactly one sentence on persistency and volume context.
    * EVIDENCE: Use SL ROI and ROI Target terms. Mention aggregate daily click totals to prove your volume understanding.`,
  prompt: `Analysis Type: {{{analysisType}}}
Constants: P_up = {{{pUp}}}, P_down = {{{pDown}}}, N = {{{nWindow}}}, K = {{{kTrigger}}}

Catalog Data (sorted by timestamp):
{{{catalogDataJson}}}

Tasks:
1. Confirm validity based on AGGREGATE EOD BU% and multi-campaign sequential flow.
2. Identify Root Cause (L1).
3. Identify L2 Reason: Underlying driver (e.g., status, suppression, campaign transition gaps).
4. Evidence: Use SL ROI and ROI Target terms. Reference AGGREGATE daily clicks.
5. Recommend a fix.
6. Justify Severity: One sentence on persistency.

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
