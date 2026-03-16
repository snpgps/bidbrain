import { z } from 'genkit';

export const BiddingDataRowSchema = z.object({
  catalog_id: z.string().describe('Unique identifier for the catalog.'),
  timestamp: z.string().describe('Timestamp of the data bucket.'),
  catalog_roi: z.number().describe('The ACTUAL calculated ROI for this catalog at this timestamp.'),
  roi_target: z.number().describe('The current ROI target set by the bidding system.'),
  sl_roi: z.number().describe('The Stop-Loss ROI threshold (protection floor).'),
  catalog_clicks: z.number().describe('Number of clicks received in this bucket.'),
  catalog_gmv: z.number().describe('Gross Merchandise Volume generated.'),
  catalog_bu_perc: z.number().describe('Budget Utilization Percentage (0 to 1 or 0 to 100).'),
  bu_ideal: z.number().describe('The target Budget Utilization level.'),
  day_roi: z.number().describe('The ROI achieved for the current day so far.'),
  spend: z.number().describe('Amount of budget spent.'),
  alpha: z.number().describe('Alpha (bid multiplier) parameter.'),
}).catchall(z.any());

export const AnalysisTypeSchema = z
  .union([
    z.literal('Low BU Analysis'),
    z.literal('Low Delivery Analysis'),
  ])
  .describe('Type of analysis to perform: Low BU Analysis or Low Delivery Analysis.');

export const DiagnoseBiddingInputSchema = z.object({
  analysisType: AnalysisTypeSchema,
  biddingData: z
    .array(BiddingDataRowSchema)
    .describe('Array of bidding data rows for multiple catalogs.'),
  nWindow: z.number().optional().describe('The window size N for ROI stability.'),
  kTrigger: z.number().optional().describe('The update trigger K (clicks).'),
});
export type DiagnoseBiddingInput = z.infer<typeof DiagnoseBiddingInputSchema>;

export const DiagnoseBiddingOutputSchema = z.object({
  catalog_id: z.string().describe('The ID of the catalog being analyzed.'),
  issue_confirmed: z
    .boolean()
    .describe('Whether the stated issue (Low BU or Low Delivery) is confirmed.'),
  root_cause: z
    .enum([
      'Slow ROI Pacing',
      'Fast Budget Pacing',
      'Fast ROI Pacing (protection side)',
      'Incorrect Catalog ROI Window',
      'Low click volume for K-trigger',
      'Budget guardrail interference',
      'Auction limitations',
      'Campaign status issues',
      'Outlier Day / Performance Death Loop',
    ])
    .describe('The primary root cause of the performance issue.'),
  l2_reason: z
    .string()
    .describe('Secondary analysis explaining why the root cause occurred.'),
  evidence: z
    .string()
    .describe('STRICT INSTRUCTION: You MUST use the exact numeric values from the provided JSON (e.g., if Catalog_ROI is 23.8, use 23.8, DO NOT use 0.9). Quote specific timestamps and values to support your claim.'),
  recommendation: z
    .string()
    .describe('Recommended parameter/system change to address the issue.'),
  severity: z
    .enum(['Low', 'Medium', 'High'])
    .describe('The severity of the issue.'),
  severity_justification: z
    .string()
    .describe('A single sentence justifying the chosen severity level.'),
});
export type DiagnoseBiddingOutput = z.infer<
  typeof DiagnoseBiddingOutputSchema
>;
