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
   - ROI Pacing to increase spending (Spending Side): When Catalog_ROI > SL_ROI and BU < BU Ideal, the system REDUCES ROI_Target to increase the bid and spending.
   - ROI Pacing to protect delivery (Protection Side): When Catalog_ROI < SL_ROI, the system INCREASES ROI_Target to decrease the bid and protect margins.
   - Budget Pacing to reduce spending when we’re overdelivering: When Catalog_ROI > SL_ROI and BU > BU Ideal, the system INCREASES ROI_Target to decrease the bid and curb over-spending.
3. Reliability Window (N): ROI stability for Catalog_ROI is calculated over a rolling window of N = {{{nWindow}}} clicks.
4. Update Trigger (K): ROI_Target is updated every K = {{{kTrigger}}} clicks based on the delivery and spending regimes.
5. Asymmetric Sensitivity (P-values):
   - P_down ({{{pDown}}}): Sensitivity for INCREASING ROI_Target (reacts fast to protect ROI).
   - P_up ({{{pUp}}}): Sensitivity for DECREASING ROI_Target (reacts slowly to scale spend).
ROI protection is the primary goal of this system.

DIAGNOSIS GUIDELINES:
- For "Low BU Analysis":
    * CONFIRMATION: Only confirm the issue if "Catalog BU%" is low at the END OF THE DAY (final daily buckets). Check this for consistent under spending through the analysis period. Understand if the issue is consistent or sporadic. Say there is no problem is BU is consistently above 80% at the end of the day. Below are some possible reasons - 
    * ROOT CAUSE ANALYSIS:
        - Slow ROI Pacing: If ROI Target is consistently high, the system is likely moving slowly through ROI pacing. It depends on the value of K clicks and if clicks are low, the module is not able to increase spending effectively.
        - Fast Budget Pacing: If ROI target is increased very fast by the Budget pacing module, it may not be able to spend aggressively. We reset the ROI target every day at the start to a lower value based on some reset logic. This doesn’t happen if the catalog roi is in 1 - 1.2 range at the end of the day as we ended up with a relatively low delivery even after budget pacing tried to get higher ROI by increasing ROI target
        - Fast ROI Pacing (protection side): Check if ROI Pacing is too fast (as delivered ROI is in denominator for the error, the error can be very high when delivered ROI is low) in increasing the ROI target, leading to a low spending on subsequent days and then switching to the ROI pacing spending module, but since clicks are low, spending doesn’t increase fast enough.
        - Incorrect Catalog ROI Window: When the ROI target is high, but we're under delivering, the ROI target will keep increasing. The problem is that the N value is too high. Even though we're over delivering in the short period (Day ROI is very high), we're not showing the same in catalog ROI because of the low clicks per day. This leads to lag in the decision making and incorrect updates to ROI target to further reduce the spending.
        - There can be a combination of reasons leading to low BU. Your job is to identify the high level reason.
    * SEVERITY: "High" only if end-of-day Low BU persists across multiple days.
    * EVIDENCE: Give reasoning for your severity rating. Use SL ROI and ROI Target terms. DO NOT mention alpha.

Note: Don’t analyse the current day because this is still ongoing and you’ll see immature BU and ROI data.`,
  prompt: `Analysis Type: {{{analysisType}}}
Constants: P_up = {{{pUp}}}, P_down = {{{pDown}}}, N = {{{nWindow}}}, K = {{{kTrigger}}}

Catalog Data:
{{{catalogDataJson}}}

Tasks:
1. Confirm validity based on EOD BU% trends.
2. Identify root cause.
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
    
    // Sort and filter current day strictly
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

    // Focus on recent history for context (up to ~3 days of buckets)
    const recentData = filteredData.slice(-100);

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
