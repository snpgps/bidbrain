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
});

const diagnoseBiddingPrompt = ai.definePrompt({
  name: 'diagnoseBiddingPrompt',
  input: { schema: LLMPromptInputSchema },
  output: { schema: DiagnoseBiddingOutputSchema },
  system: `You are a senior Ads Bidding PM analyzing catalog-level bidding data.

Your job:
Diagnose root cause of either:
* Low Budget Utilisation (BU)
  OR
* Low ROI Delivery

Use only the provided data.
Be structured.
Be precise.
Avoid generic explanations.`,
  prompt: `Analysis Type: {{{analysisType}}}

Below is time-bucket level data for a single catalog.

Data:
{{{catalogDataJson}}}

Tasks:

1. Determine whether the stated issue is valid.
2. Identify the primary root cause. Choose one:
   * Over-aggressive ROI correction
   * Under-reaction (P too low)
   * Noise from high click velocity
   * Window size (N) too small for traffic
   * Daypart volatility
   * Delayed order maturity distortion
   * Budget guardrail interference
   * Seller SL too high
   * Bidding ceiling (auction limitation)
3. Provide evidence from data.
4. Recommend parameter/system change.
5. Classify severity: Low / Medium / High.

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

    const catalogDataMap = new Map<string, z.infer<typeof BiddingDataRowSchema>[]>();

    for (const row of biddingData) {
      if (!catalogDataMap.has(row.catalog_id)) {
        catalogDataMap.set(row.catalog_id, []);
      }
      catalogDataMap.get(row.catalog_id)?.push(row);
    }

    const results: DiagnoseBiddingOutput[] = [];

    for (const [catalog_id, catalogRows] of catalogDataMap.entries()) {
      const {output} = await diagnoseBiddingPrompt({
        analysisType,
        catalogDataJson: JSON.stringify(catalogRows, null, 2),
        catalog_id: catalog_id,
      });
      if (output) {
        // Ensure the catalog_id from the data matches the LLM's output for consistency
        results.push({...output, catalog_id: output.catalog_id || catalog_id});
      }
    }

    return results;
  }
);

export async function diagnoseBiddingPerformance(
  input: DiagnoseBiddingInput
): Promise<DiagnoseBiddingOutput[]> {
  return diagnoseBiddingPerformanceFlow(input);
}
