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
import { parseBiddingCsv } from '@/lib/csv-utils';

const LLMPromptInputSchema = z.object({
  analysisType: AnalysisTypeSchema,
  catalogDataJson: z
    .string()
    .describe('JSON string of time-bucket level data for a single catalog.'),
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
    * CONFIRMATION: Only confirm the issue if "Catalog BU%" is low at the END OF THE DAY (final daily buckets). Check this for consistent under spending through the analysis period. Say there is no problem if BU is consistently above 80% at the end of the day.
    * ROOT CAUSE ANALYSIS (L1):
        - Slow ROI Pacing: If ROI Target is consistently high and moving slowly despite high delivered ROI. Often tied to low click volume preventing K-trigger updates.
        - Fast Budget Pacing: If ROI target was increased very fast by the Budget pacing module.
        - Fast ROI Pacing (protection side): If ROI Pacing increased target too fast during a low-ROI period.
        - Incorrect Catalog ROI Window: If high N value causes lag in updating ROI Target despite high Day ROI.
        - Campaign status issues: If the catalog/campaign status is "paused" or "inactive" for significant periods.
    * L2 REASONING (The "Why"): Identify the underlying driver of the L1 issue. L2 MUST NOT repeat L1.
        - Check "status" columns: Is it paused?
        - Check history: Did a previous ROI crash cause a massive ROI Target spike (System Suppression)?
        - Check volume: Is there naturally low click volume or is it system-suppressed?
    * SEVERITY: "High" only if end-of-day Low BU persists across multiple days.
    * SEVERITY JUSTIFICATION: Exactly one sentence summarizing the persistency of the issue.
    * EVIDENCE: Give reasoning for your severity rating. Use SL ROI and ROI Target terms. DO NOT mention alpha.

Note: Don’t analyse the current day because this is still ongoing and you’ll see immature BU and ROI data.`,
  prompt: `Analysis Type: {{{analysisType}}}
Constants: P_up = {{{pUp}}}, P_down = {{{pDown}}}, N = {{{nWindow}}}, K = {{{kTrigger}}}

Catalog Data:
{{{catalogDataJson}}}

Tasks:
1. Confirm validity based on EOD BU% trends.
2. Identify Root Cause (L1).
3. Identify L2 Reason: Short explanation (few words) of the underlying driver. DO NOT repeat the L1 root cause.
4. Evidence: Use SL ROI and ROI Target terms. DO NOT mention alpha.
5. Recommend a fix.
6. Justify Severity: Exactly one sentence reasoning for severity level.

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

  // Fetch data from storage if URL is provided
  if (input.fileUrl) {
    biddingData = await fetchCsvFromUrl(input.fileUrl);
  }

  if (!biddingData || biddingData.length === 0) {
    throw new Error("No bidding data provided for analysis.");
  }

  const {analysisType, nWindow = 1800, kTrigger = 360} = input;

  // Filter out current day (incomplete data)
  const today = new Date().toISOString().split('T')[0];
  const historicalData = biddingData.filter(row => !row.timestamp.startsWith(today));

  if (historicalData.length === 0) {
    throw new Error("No complete historical days found in data. Diagnostics require at least one full day of history.");
  }

  const catalogDataMap = new Map<string, z.infer<typeof BiddingDataRowSchema>[]>();
  for (const row of historicalData) {
    if (!catalogDataMap.has(row.catalog_id)) {
      catalogDataMap.set(row.catalog_id, []);
    }
    catalogDataMap.get(row.catalog_id)?.push(row);
  }

  const catalogIds = Array.from(catalogDataMap.keys());
  const limitedCatalogIds = catalogIds.slice(0, 20);

  const pUp = biddingData[0]?.p_up ?? input.pUp ?? 0.1;
  const pDown = biddingData[0]?.p_down ?? input.pDown ?? 0.2;

  const diagnosticPromises = limitedCatalogIds.map(async (catalogId) => {
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
