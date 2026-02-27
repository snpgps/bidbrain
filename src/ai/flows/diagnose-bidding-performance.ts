'use server';
/**
 * @fileOverview This file implements a Genkit flow for diagnosing bidding performance issues.
 *
 * - diagnoseBiddingPerformance - A function that orchestrates the AI-powered diagnosis of bidding data.
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
});

const diagnoseBiddingPrompt = ai.definePrompt({
  name: 'diagnoseBiddingPrompt',
  input: { schema: LLMPromptInputSchema },
  output: { schema: DiagnoseBiddingOutputSchema },
  system: `You are a senior Ads Bidding PM and Data Scientist. You are diagnosing a bidding control system based on the following logic:

CORE SYSTEM LOGIC:
1. Bid Formula: Bid = alpha * pCVR * (AOV / SL_ROI). alpha is a pacing multiplier.
2. Error Calculation: error = (SL_ROI - matured_ROI) / SL_ROI. 
   - error > 0: Under-delivering ROI (Need to decrease bids/alpha).
   - error < 0: Over-delivering ROI (Can increase bids/alpha).
3. Correction Asymmetry (P-values):
   - P_down (default 0.2): Used when error > 0 to react fast and protect ROI.
   - P_up (default 0.1): Used when error < 0 to scale slowly and avoid ROI drops.
4. Alpha Update: alpha_t = alpha_t-1 * clip(1 + P * error, 0.5, 1.5).
5. Reliability: Uses a rolling window N (3000 clicks) and updates every K (600 clicks).
6. BU Behavior: Budget Utilization resets if the budget is changed during the day (check budget_change_flag).

DIAGNOSIS GUIDELINES:
- For "Low BU Analysis":
    * Severity is "High" ONLY if Low BU is persistent across multiple full days.
    * Check if alpha is suppressed due to "Over-aggressive ROI correction" (P_down too high or error calculation noise).
    * Consider "Seller SL too high" as a common cause for low delivery.
- For "Low Delivery Analysis":
    * Look for alpha stagnation or "Under-reaction" (P_up too low).
    * Check for "Bidding ceiling" where even high alpha doesn't increase spend.

Use the provided JSON data (which excludes the current incomplete day) to identify the primary root cause.`,
  prompt: `Analysis Type: {{{analysisType}}}
Current System Constants: P_up = {{{pUp}}}, P_down = {{{pDown}}}

Catalog Data (Time-bucketed):
{{{catalogDataJson}}}

Tasks:
1. Confirm if the issue is valid based on the multi-day trends.
2. Identify the root cause from this specific list:
   - Over-aggressive ROI correction
   - Under-reaction (P too low)
   - Noise from high click velocity
   - Window size (N) too small for traffic
   - Daypart volatility
   - Delayed order maturity distortion
   - Budget guardrail interference
   - Seller SL too high
   - Bidding ceiling (auction limitation)
3. Provide evidence (mention specific ROI, SL_ROI, or Alpha trends).
4. Recommend a fix (e.g., "Decrease P_down", "Increase N", "Lower SL_ROI").
5. Assign Severity: Low, Medium, or High (High only for persistent BU issues).

Return output in JSON format:
{
"catalog_id": "",
"issue_confirmed": true/false,
"root_cause": "",
"evidence": "",
"recommendation": "",
"severity": ""
}`,
});

const diagnoseBiddingPerformanceFlow = ai.defineFlow(
  {
    name: 'diagnoseBiddingPerformanceFlow',
    inputSchema: DiagnoseBiddingInputSchema,
    outputSchema: z.array(DiagnoseBiddingOutputSchema),
  },
  async (input) => {
    const {analysisType, biddingData} = input;

    if (!biddingData || biddingData.length === 0) return [];

    // 1. Group by catalog first
    const catalogDataMap = new Map<string, z.infer<typeof BiddingDataRowSchema>[]>();
    for (const row of biddingData) {
      if (!catalogDataMap.has(row.catalog_id)) {
        catalogDataMap.set(row.catalog_id, []);
      }
      catalogDataMap.get(row.catalog_id)?.push(row);
    }

    const catalogIds = Array.from(catalogDataMap.keys());
    const limitedCatalogIds = catalogIds.slice(0, 20); // Cap at 20 catalogs to avoid timeouts

    // 2. Process each catalog's data (filter current day per catalog)
    const pUp = biddingData[0]?.p_up ?? 0.1;
    const pDown = biddingData[0]?.p_down ?? 0.2;

    const diagnosticPromises = limitedCatalogIds.map(async (catalogId) => {
      const catalogRows = catalogDataMap.get(catalogId)!;
      
      // Determine the latest day in this catalog's data
      const dates = catalogRows.map(row => row.timestamp?.split(' ')[0] || row.timestamp?.split('T')[0]).filter(Boolean);
      const uniqueDates = [...new Set(dates)].sort();
      
      let filteredData = catalogRows;
      if (uniqueDates.length > 1) {
        const latestDate = uniqueDates[uniqueDates.length - 1];
        filteredData = catalogRows.filter(row => {
          const date = row.timestamp?.split(' ')[0] || row.timestamp?.split('T')[0];
          return date !== latestDate;
        });
      }

      if (filteredData.length === 0) return null;

      // Take most recent 50 buckets to avoid context bloat and speed up inference
      const recentData = filteredData.slice(-50);

      try {
        const {output} = await diagnoseBiddingPrompt({
          analysisType,
          catalogDataJson: JSON.stringify(recentData, null, 2),
          catalog_id: catalogId,
          pUp,
          pDown,
        });
        return output ? { ...output, catalog_id: output.catalog_id || catalogId } : null;
      } catch (error) {
        console.error(`Error processing catalog ${catalogId}:`, error);
        return null;
      }
    });

    const results = await Promise.all(diagnosticPromises);
    return results.filter((res): res is DiagnoseBiddingOutput => res !== null);
  }
);

export async function diagnoseBiddingPerformance(
  input: DiagnoseBiddingInput
): Promise<DiagnoseBiddingOutput[]> {
  return diagnoseBiddingPerformanceFlow(input);
}
