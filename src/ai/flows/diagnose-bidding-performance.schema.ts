import { z } from 'genkit';

export const BiddingDataRowSchema = z.object({
  catalog_id: z.string().describe('Unique identifier for the catalog.'),
  timestamp: z.string().describe('Timestamp of the data bucket. MUST be used exactly as provided.'),
  catalog_roi: z.number().describe('The ACTUAL ROI value. DO NOT NORMALIZE. If it is 250, use 250.'),
  roi_target: z.number().describe('The current ROI target. Use the raw numeric value.'),
  sl_roi: z.number().describe('The Stop-Loss ROI threshold.'),
  catalog_clicks: z.number().describe('Number of clicks.'),
  catalog_gmv: z.number().describe('Gross Merchandise Volume.'),
  catalog_bu_perc: z.number().describe('Budget Utilization Percentage (e.g. 0-100).'),
  bu_ideal: z.number().describe('The target Budget Utilization level.'),
  day_roi: z.number().describe('Achieved ROI for the day.'),
  spend: z.number().describe('Amount of budget spent.'),
  alpha: z.number().describe('Alpha (bid multiplier).'),
}).catchall(z.any());

export const AnalysisTypeSchema = z
  .union([
    z.literal('Low BU Analysis'),
    z.literal('Low Delivery Analysis'),
  ])
  .describe('Type of analysis to perform.');

export const DiagnoseBiddingInputSchema = z.object({
  analysisType: AnalysisTypeSchema,
  biddingData: z
    .array(BiddingDataRowSchema)
    .describe('Array of bidding data rows.'),
  nWindow: z.number().optional(),
  kTrigger: z.number().optional(),
});
export type DiagnoseBiddingInput = z.infer<typeof DiagnoseBiddingInputSchema>;

export const DiagnoseBiddingOutputSchema = z.object({
  catalog_id: z.string(),
  issue_confirmed: z.boolean(),
  root_cause: z.enum([
    'Slow ROI Pacing',
    'Fast Budget Pacing',
    'Fast ROI Pacing (protection side)',
    'Incorrect Catalog ROI Window',
    'Low click volume for K-trigger',
    'Budget guardrail interference',
    'Auction limitations',
    'Campaign status issues',
    'Outlier Day / Performance Death Loop',
  ]),
  l2_reason: z.string(),
  evidence: z.string().describe('CRITICAL: Quote the EXACT numeric values and timestamps from the JSON provided in the prompt. DO NOT use example numbers. DO NOT normalize. If the data shows 200, use 200. Check the timestamps carefully.'),
  recommendation: z.string(),
  severity: z.enum(['Low', 'Medium', 'High']),
  severity_justification: z.string(),
});
export type DiagnoseBiddingOutput = z.infer<typeof DiagnoseBiddingOutputSchema>;
