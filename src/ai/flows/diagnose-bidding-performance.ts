'use server';
/**
 * @fileOverview This file implements a Genkit flow for bidding performance diagnostics using Gemini 2.5 Flash.
 * It enforces strict numeric accuracy to prevent hallucinations.
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
  catalogDataJson: z.string().describe('JSON string of data rows.'),
  catalog_id: z.string(),
  pUp: z.number(),
  pDown: z.number(),
  nWindow: z.number(),
  kTrigger: z.number(),
  systemPrompt: z.string().optional(),
  userPrompt: z.string().optional(),
});

const DEFAULT_SYSTEM_PROMPT = `You are a Strict Bidding Control Auditor. You are diagnosing a system using RAW LOG DATA.

TRUTH ANCHORING - MANDATORY:
1. USE EXACT NUMBERS: If Catalog_ROI is 23.8, you MUST say 23.8. NEVER say 0.9 or any other normalized number.
2. USE EXACT TIMESTAMPS: Only reference timestamps provided in the JSON data.
3. NO HALLUCINATION: If a value is not in the data, do not mention it.
4. DO NOT NORMALIZE: Keep all values in their original units as provided in the JSON.

CORE CONTROL LOGIC:
1. ROI Pacing: If Catalog_ROI > SL_ROI and BU < BU Ideal, REDUCE ROI_Target to scale.
2. Protection: If Catalog_ROI < SL_ROI, INCREASE ROI_Target rapidly (P_down) to protect margins.
3. Reliability: Window N = {{{nWindow}}} clicks. Update Trigger K = {{{kTrigger}}} clicks.

DIAGNOSIS CATEGORIES:
- Slow ROI Pacing
- Fast Budget Pacing
- Fast ROI Pacing (protection side)
- Outlier Day / Performance Death Loop
- Incorrect Catalog ROI Window
- Low click volume for K-trigger
- Campaign status issues`;

const DEFAULT_USER_PROMPT = `Analysis Type: {{{analysisType}}}
Bidding Constants: P_up={{{pUp}}}, P_down={{{pDown}}}, N={{{nWindow}}}, K={{{kTrigger}}}

CATALOG DATA (JSON):
{{{catalogDataJson}}}

In your 'evidence' field, you MUST quote the exact raw numbers (e.g. Catalog_ROI, ROI_Target, Clicks) and timestamps from the JSON above. Explain the specific row that triggered the logic.`;

const diagnoseBiddingPrompt = ai.definePrompt({
  name: 'diagnoseBiddingPrompt',
  input: { schema: LLMPromptInputSchema },
  output: { schema: DiagnoseBiddingOutputSchema },
  system: `{{#if systemPrompt}}{{{systemPrompt}}}{{else}}${DEFAULT_SYSTEM_PROMPT}{{/if}}`,
  prompt: `{{#if userPrompt}}{{{userPrompt}}}{{else}}${DEFAULT_USER_PROMPT}{{/if}}`,
});

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
        await new Promise(r => setTimeout(r, Math.pow(2, retryCount) * 2000));
      } else {
        throw err;
      }
    }
  }
  return null;
}

export async function fetchCsvFromUrl(url: string): Promise<any[]> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch file: ${response.statusText}`);
    const text = await response.text();
    const { parseBiddingCsv } = await import('@/lib/csv-utils');
    return parseBiddingCsv(text);
  } catch (err) {
    throw err;
  }
}
