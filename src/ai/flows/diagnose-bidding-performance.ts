'use server';
/**
 * @fileOverview This file implements a Genkit flow for high-speed bidding performance diagnostics.
 * It supports dynamic prompt injection from the UI.
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
  // Dynamic instructions passed from Firestore/UI
  systemPrompt: z.string().optional(),
  userPrompt: z.string().optional(),
});

const DEFAULT_SYSTEM_PROMPT = `You are a senior Ads Bidding PM. You are diagnosing a bidding control system based on RAW LOG DATA.

CORE CONTROL LOGIC:
1. ROI Pacing: If Catalog_ROI > SL_ROI and BU < BU Ideal, REDUCE ROI_Target to scale.
2. Protection: If Catalog_ROI < SL_ROI, INCREASE ROI_Target rapidly (P_down) to protect margins.
3. Reliability: Window N = {{{nWindow}}} clicks. Update Trigger K = {{{kTrigger}}} clicks.

STRICT NUMERIC ACCURACY:
- You MUST reference the EXACT numbers provided in the JSON.
- DO NOT normalize or scale values. If the data says Catalog_ROI = 23.8, DO NOT say 0.9.
- Reference specific timestamps from the data to show trends.

DIAGNOSIS CATEGORIES:
- Slow ROI Pacing: ROI Target is high and moving slowly.
- Fast Budget Pacing: ROI target increased too rapidly.
- Fast ROI Pacing (protection side): High spike in ROI Target during a low-ROI period.
- Outlier Day / Performance Death Loop: Spend behaved differently leading to low ROI, causing a drop in Catalog ROI and a persistent ROI target increase.
- Incorrect Catalog ROI Window: Large N causes lag. Day ROI is high, but Catalog ROI remains low.
- Low click volume for K-trigger: Total daily clicks < K trigger.
- Campaign status issues: Paused or inactive.`;

const DEFAULT_USER_PROMPT = `Analysis Type: {{{analysisType}}}
Constants: P_up = {{{pUp}}}, P_down = {{{pDown}}}, N = {{{nWindow}}}, K = {{{kTrigger}}}

Catalog Data:
{{{catalogDataJson}}}

In your 'evidence' field, you MUST quote the exact raw numbers (e.g. Catalog_ROI, ROI_Target, Clicks) from the JSON above. Explain exactly which timestamp triggered the logic.`;

const diagnoseBiddingPrompt = ai.definePrompt({
  name: 'diagnoseBiddingPrompt',
  input: { schema: LLMPromptInputSchema },
  output: { schema: DiagnoseBiddingOutputSchema },
  system: `{{#if systemPrompt}}{{{systemPrompt}}}{{else}}${DEFAULT_SYSTEM_PROMPT}{{/if}}`,
  prompt: `{{#if userPrompt}}{{{userPrompt}}}{{else}}${DEFAULT_USER_PROMPT}{{/if}}`,
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
  systemPrompt?: string;
  userPrompt?: string;
}): Promise<DiagnoseBiddingOutput | null> {
  const { analysisType, catalogId, catalogData, pUp, pDown, nWindow, kTrigger, systemPrompt, userPrompt } = input;

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
        systemPrompt,
        userPrompt,
      });

      if (output) {
        return { ...output, catalog_id: catalogId };
      }
      return null;
    } catch (err: any) {
      const isRateLimit = err.message.includes('429') || err.message.includes('Quota');
      if (isRateLimit) {
        retryCount++;
        if (retryCount <= maxRetries) {
          // Exponential backoff
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
