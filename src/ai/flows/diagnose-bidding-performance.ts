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
  system: `You are a senior Ads Bidding PM and Data Scientist. You are diagnosing a bidding control system.

CORE SYSTEM LOGIC:
1. Bid Formula: Bid = alpha * pCVR * (AOV / SL_ROI). alpha is a pacing multiplier.
2. Error Calculation: error = (SL_ROI - matured_ROI) / SL_ROI. 
3. Reliability Window (N): The system uses a rolling window of N = {{{nWindow}}} clicks to calculate ROI stability. 
4. Update Trigger (K): The system updates the bid pacing every K = {{{kTrigger}}} clicks. 
5. Asymmetric Correction (P-values):
   - P_down: React fast when ROI is below SL_ROI. (Current P_down = {{{pDown}}})
   - P_up: Scale slowly when ROI is above SL_ROI. (Current P_up = {{{pUp}}})
6. Update Rule: alpha_t = alpha_t-1 * clip(1 + P * error, 0.5, 1.5).

COMMUNICATION CONSTRAINTS:
- NEVER use the term "alpha" in your evidence or reasoning.
- ALWAYS use the terms "SL ROI" and "ROI target" to describe performance benchmarks.
- Use "Budget Pacing" and "ROI Pacing" to describe the system's directional adjustments.

DIAGNOSIS GUIDELINES:
- For "Low BU Analysis":
    * ISSUE CONFIRMATION: Only confirm the issue if the "Catalog BU%" is low at the END OF THE DAY (the final bucket for each date). Ignore intra-day dips.
    * RESET AWARENESS: Budget Utilization resets if a budget change occurs (check budget_change_flag). Account for this in your analysis of intra-day data.
    * SEVERITY: Severity is "High" ONLY if end-of-day Low BU is persistent across multiple full days in the provided data.
    * ROOT CAUSE: Check if ROI Pacing is suppressed due to "Over-aggressive ROI correction" (SL ROI >> matured ROI).

- For "Low Delivery Analysis":
    * Confirm if ROI Pacing fails to scale despite matured ROI being consistently better (higher) than SL ROI.
    * Consider if the K trigger ({{{kTrigger}}} clicks) is too sparse for the catalog's scale.

Note: The data provided excludes the current ongoing day. All data buckets are from completed historical days.`,
  prompt: `Analysis Type: {{{analysisType}}}
Current System Constants: P_up = {{{pUp}}}, P_down = {{{pDown}}}, N = {{{nWindow}}}, K = {{{kTrigger}}}

Catalog Data (Historical Full Days Only):
{{{catalogDataJson}}}

Tasks:
1. Confirm if the issue is valid based on end-of-day BU% trends and multi-day history.
2. Identify the root cause from the provided schema list.
3. Provide evidence: Use SL ROI and ROI Target terms. Describe Budget Pacing trends. DO NOT mention alpha.
4. Recommend a fix (e.g., "Decrease P_down", "Lower SL_ROI", "Increase N").
5. Assign Severity: Low, Medium, or High.
6. Provide a "severity_justification": Justify based on end-of-day persistency and impact.

Return output in JSON format:
{
"catalog_id": "{{{catalog_id}}}",
"issue_confirmed": true/false,
"root_cause": "",
"evidence": "",
"recommendation": "",
"severity": "",
"severity_justification": ""
}`,
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

    if (filteredData.length === 0) {
       return null;
    }

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

      if (!output) {
        throw new Error(`AI failed to generate analysis for catalog ${catalogId}.`);
      }

      return { ...output, catalog_id: catalogId };
    } catch (error: any) {
      throw new Error(`AI Error for ${catalogId}: ${error.message}`);
    }
  });

  const results = await Promise.all(diagnosticPromises);
  return results.filter((res): res is DiagnoseBiddingOutput => res !== null);
}
