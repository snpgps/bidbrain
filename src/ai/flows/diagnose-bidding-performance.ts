'use server';
/**
 * @fileOverview This file implements a Genkit flow for high-speed bidding performance diagnostics.
 * It uses the latest Gemini 2.0 Flash model for rapid analysis.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import {
  DiagnoseBiddingOutputSchema,
  DiagnoseBiddingOutput,
  AnalysisTypeSchema,
} from './diagnose-bidding-performance.schema';

const LLMPromptInputSchema = z.object({
  analysisType: AnalysisTypeSchema,
  catalogDataJson: z
    .string()
    .describe('JSON string of time-bucket level data for a single catalog.'),
  catalog_id: z
    .string()
    .describe('The ID of the catalog for which the data is provided.'),
  pUp: z.number().describe('The P_up constant.'),
  pDown: z.number().describe('The P_down constant.'),
  nWindow: z.number().describe('The window size N.'),
  kTrigger: z.number().describe('The trigger K.'),
});

const diagnoseBiddingPrompt = ai.definePrompt({
  name: 'diagnoseBiddingPrompt',
  input: { schema: LLMPromptInputSchema },
  output: { schema: DiagnoseBiddingOutputSchema },
  system: `You are a senior Ads Bidding PM. You are diagnosing a bidding control system.

CORE CONTROL LOGIC:
1. ROI Pacing: If Catalog_ROI > SL_ROI and BU < BU Ideal, REDUCE ROI_Target to scale.
2. Protection: If Catalog_ROI < SL_ROI, INCREASE ROI_Target rapidly (P_down) to protect margins.
3. Reliability: Window N = {{{nWindow}}} clicks. Update Trigger K = {{{kTrigger}}} clicks.

DIAGNOSIS CATEGORIES (ROOT CAUSE):
- Slow ROI Pacing: ROI Target is high and moving slowly.
- Fast Budget Pacing: ROI target increased too rapidly.
- Fast ROI Pacing (protection side): High spike in ROI Target during a low-ROI period.
- Outlier Day / Performance Death Loop: Spend behaved differently (sale/click mix) leading to low ROI, causing a drop in Catalog ROI and a persistent ROI target increase. This puts the catalog in a "low clicks, low ROI" death loop.
- Incorrect Catalog ROI Window: Large N causes lag. Day ROI is high, but Catalog ROI remains low.
- Low click volume for K-trigger: Total daily clicks < K trigger.
- Campaign status issues: Paused or inactive.

ANALYSIS TASKS:
1. Aggregate clicks across all campaign buckets for the day.
2. If Catalog_ROI is consistently below SL_ROI, check for "Outlier Day" spikes that triggered "Performance Death Loop".
3. Use SL ROI and ROI Target terms in evidence. Reference AGGREGATE daily clicks.`,
  prompt: `Analysis Type: {{{analysisType}}}
Constants: P_up = {{{pUp}}}, P_down = {{{pDown}}}, N = {{{nWindow}}}, K = {{{kTrigger}}}

Catalog Data:
{{{catalogDataJson}}}

Return JSON matching the schema.`,
});

/**
 * Server Action to analyze a single catalog.
 */
export async function analyzeCatalogAction(input: {
  analysisType: 'Low BU Analysis' | 'Low Delivery Analysis';
  catalogId: string;
  catalogData: any[];
  pUp: number;
  pDown: number;
  nWindow: number;
  kTrigger: number;
}): Promise<DiagnoseBiddingOutput | null> {
  const { analysisType, catalogId, catalogData, pUp, pDown, nWindow, kTrigger } = input;

  const sortedData = [...catalogData].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  let retryCount = 0;
  const maxRetries = 2;
  
  while (retryCount <= maxRetries) {
    try {
      const { output } = await diagnoseBiddingPrompt({
        analysisType,
        catalogDataJson: JSON.stringify(sortedData, null, 2),
        catalog_id: catalogId,
        pUp,
        pDown,
        nWindow,
        kTrigger,
      });

      if (output) {
        return { ...output, catalog_id: catalogId };
      }
      return null;
    } catch (err: any) {
      if (err.message.includes('429') || err.message.includes('Quota')) {
        retryCount++;
        if (retryCount <= maxRetries) {
          await new Promise(r => setTimeout(r, Math.pow(2, retryCount) * 2000));
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }
  }
  return null;
}

/**
 * Server Action to fetch and parse CSV data from a URL.
 */
export async function fetchCsvFromUrl(url: string): Promise<any[]> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);
    const text = await response.text();
    const { parseBiddingCsv } = await import('@/lib/csv-utils');
    return parseBiddingCsv(text);
  } catch (err) {
    console.error("Error fetching historical CSV:", err);
    throw err;
  }
}
