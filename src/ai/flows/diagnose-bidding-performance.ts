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
   - A window size (N) that is too small for high-traffic catalogs may lead to "Noise from high click velocity".
4. Update Trigger (K): The system updates the bid pacing every K = {{{kTrigger}}} clicks. 
   - If K is too high, the system might be "Under-reacting" or slow to adapt.
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
    * Severity is "High" ONLY if Low BU (Budget Utilization) is persistent across multiple full days of historical data.
    * Check if ROI Pacing is suppressed due to "Over-aggressive ROI correction" where SL ROI is much higher than matured ROI.
- For "Low Delivery Analysis":
    * Look for ROI Pacing stagnation or "Under-reaction" where the system fails to scale despite matured ROI being better than SL ROI.
    * Consider if the K trigger ({{{kTrigger}}} clicks) is too sparse for the catalog's current scale.

Note: The data provided has already been filtered to remove the current ongoing day. All data buckets are from completed days.`,
  prompt: `Analysis Type: {{{analysisType}}}
Current System Constants: P_up = {{{pUp}}}, P_down = {{{pDown}}}, N = {{{nWindow}}}, K = {{{kTrigger}}}

Catalog Data (Historical Full Days Only):
{{{catalogDataJson}}}

Tasks:
1. Confirm if the issue is valid based on the multi-day trends.
2. Identify the root cause from the provided schema list.
3. Provide evidence: Quote specific values for SL ROI, ROI Target, and matured ROI. Describe Budget Pacing trends.
4. Recommend a fix (e.g., "Decrease P_down", "Lower SL_ROI", "Increase N").
5. Assign Severity: Low, Medium, or High.
6. Provide a "severity_justification": Justify the severity at the catalog level based on persistency and revenue impact.

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

  // 1. Group by catalog first
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

  // 2. Process each catalog's data
  const diagnosticPromises = limitedCatalogIds.map(async (catalogId) => {
    const catalogRows = catalogDataMap.get(catalogId)!;
    
    // STRICT FILTERING: Identify and remove the absolute latest date present in the data
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
       console.warn(`No historical data left for catalog ${catalogId} after filtering today's data.`);
       return null;
    }

    const recentData = filteredData.slice(-50);

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
