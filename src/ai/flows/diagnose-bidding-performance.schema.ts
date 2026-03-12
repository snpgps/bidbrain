import { z } from 'genkit';

export const BiddingDataRowSchema = z.object({
  catalog_id: z.string().describe('Unique identifier for the catalog.'),
  timestamp: z.string().describe('Timestamp of the data bucket.'),
  catalog_roi: z.number().describe('Return on Investment for the catalog.'),
  roi_target: z.number().describe('Target ROI for the catalog.'),
  sl_roi: z.number().describe('Stop-loss ROI for the catalog.'),
  catalog_clicks: z.number().describe('Number of clicks for the catalog.'),
  catalog_gmv: z.number().describe('Gross Merchandise Volume for the catalog.'),
  catalog_bu_perc: z
    .number()
    .describe('Budget Utilization Percentage for the catalog.'),
  bu_ideal: z.number().describe('Ideal Budget Utilization.'),
  day_roi: z.number().describe('Daily ROI.'),
  spend: z.number().describe('Spend for the catalog.'),
  alpha: z.number().describe('Alpha parameter.'),
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
    .describe('Evidence from the data supporting the diagnosis.'),
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
