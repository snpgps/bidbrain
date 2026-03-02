'use server';
/**
 * @fileOverview This file implements a Genkit flow for diagnosing bidding performance issues.
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

const LLMPromptInputSchema = z.object({
  analysisType: AnalysisTypeSchema,
  catalogDataJson: z
    .string()
    .describe('JSON string of time-bucket level data for a single catalog.'),
  catalog_id: z
    .string()
    .describe('The ID of the catalog for which the data is provided.'),
  pUp: z.number().describe('The P_up constant used in the control system.'),
  pDown: z.number().describe('The P_down constant used in the control system.'),
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
   - Initial ROI_Target = SL_ROI (the seller-provided floor).
   - ROI Pacing (Scaling): When ROI_matured > SL_ROI and BU < Ideal, the system REDUCES ROI_Target to increase the bid and spending.
   - ROI Pacing (Protection): When ROI_matured < SL_ROI, the system INCREASES ROI_Target to decrease the bid and protect margins.
   - Budget Pacing (Control): When ROI_matured > SL_ROI and BU > Ideal, the system INCREASES ROI_Target to decrease the bid and curb over-spending.
3. Reliability Window (N): ROI stability is calculated over a rolling window of N = {{{nWindow}}} clicks.
4. Update Trigger (K): ROI_Target is updated every K = {{{kTrigger}}} clicks.
5. Asymmetric Sensitivity (P-values):
   - P_down ({{{pDown}}}): Sensitivity for INCREASING ROI_Target (reacts fast to protect ROI).
   - P_up ({{{pUp}}}): Sensitivity for DECREASING ROI_Target (reacts slowly to scale spend).

COMMUNICATION CONSTRAINTS:
- NEVER use the term "alpha".
- ALWAYS use the terms "SL ROI" (the baseline) and "ROI Target" (the dynamic bid driver).
- Use "ROI Pacing" and "Budget Pacing" to describe the directional movement of the ROI Target.

DIAGNOSIS GUIDELINES:
- For "Low BU Analysis":
    * CONFIRMATION: Only confirm the issue if "Catalog BU%" is low at the END OF THE DAY (final daily buckets).
    * ROOT CAUSE ANALYSIS:
        - If ROI Target is consistently >> SL ROI: The system is likely stuck in "Protection" or "Control" mode.
        - Check if ROI Pacing is too aggressive in increasing the Target (P_down too high) when ROI dips occur.
        - Check if Budget Pacing is too aggressive in increasing the Target (over-reacting to spend spikes).
        - Check if ROI Pacing is too slow in decreasing the Target (P_up too low) when ROI is over-delivering.
    * SEVERITY: "High" only if end-of-day Low BU persists across multiple days.
    * EVIDENCE: Quote specific instances where ROI Target increased despite ROI being healthy, or where it failed to decrease when BU was low.

Note: All data provided excludes the current ongoing day.`,
  prompt: `Analysis Type: {{{analysisType}}}
Constants: P_up = {{{pUp}}}, P_down = {{{pDown}}}, N = {{{nWindow}}}, K = {{{kTrigger}}}

Catalog Data:
{{{catalogDataJson}}}

Tasks:
1. Confirm validity based on EOD BU% trends.
2. Identify root cause (e.g., Over-aggressive ROI Target increase, Stagnant Target reduction).
3. Evidence: Use SL ROI and ROI Target terms. DO NOT mention alpha.
4. Recommend a fix (e.g., "Decrease P_down", "Increase P_up", "Increase N").
5. Justify Severity at the catalog level based on persistency.

Return JSON matching the schema.`,
});

export async function diagnoseBiddingPerformance(
  input: DiagnoseBiddingInput
): Promise<DiagnoseBiddingOutput[]> {
  const {analysisType, biddingData, nWindow = 1800, kTrigger = 360} = input;

  if (!biddingData || biddingData.length === 0) {
    throw new Error("No bidding data provided for analysis.");
  }

  const catalogDataMap = new Map<string, z.infer<typeof BiddingDataRowSchema>[]>();
  for (const row of biddingData) {
    if (!catalogDataMap.has(row.catalog_id)) {
      catalogDataMap.set(row.catalog_id, []);
    }
    catalogDataMap.get(row.catalog_id)?.push(row);
  }

  const catalogIds = Array.from(catalogDataMap.keys());
  const limitedCatalogIds = catalogIds.slice(0, 20);

  const pUp = biddingData[0]?.p_up ?? 0.1;
  const pDown = biddingData[0]?.p_down ?? 0.2;

  const diagnosticPromises = limitedCatalogIds.map(async (catalogId) => {
    const catalogRows = catalogDataMap.get(catalogId)!;
    
    // Sort and filter current day
    const dateStrings = catalogRows.map(row => {
      const t = row.timestamp || "";
      return t.includes(' ') ? t.split(' ')[0] : t.split('T')[0];
    }).filter(d => d.length > 0);

    const uniqueDates = [...new Set(dateStrings)].sort();
    
    let filteredData = catalogRows;
    if (uniqueDates.length > 0) {
      const latestDate = uniqueDates[uniqueDates.length - 1];
      filteredData = catalogRows.filter(row => {
        const t = row.timestamp || "";
        const rowDate = t.includes(' ') ? t.split(' ')[0] : t.split('T')[0];
        return rowDate !== latestDate;
      });
    }

    if (filteredData.length === 0) return null;

    // Focus on recent history for context
    const recentData = filteredData.slice(-60);

    try {
      const {output} = await diagnoseBiddingPrompt({
        analysisType,
        catalogDataJson: JSON.stringify(recentData, null, 2),
        catalog_id: catalogId,
        pUp,
        pDown,
        nWindow,
        kTrigger,
      });

      if (!output) return null;

      return { ...output, catalog_id: catalogId };
    } catch (error: any) {
      // Re-throw with context to be caught by the UI
      throw new Error(`AI Diagnostic Error for Catalog ${catalogId}: ${error.message}`);
    }
  });

  const results = await Promise.all(diagnosticPromises);
  const validResults = results.filter((res): res is DiagnoseBiddingOutput => res !== null);

  if (validResults.length === 0) {
    throw new Error("Analysis completed but no valid insights were generated. Ensure the data has enough history outside of the current day.");
  }

  return validResults;
}
