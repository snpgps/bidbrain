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
  p_up: z.number().describe('P_up parameter.'),
  p_down: z.number().describe('P_down parameter.'),
  budget_change_flag: z
    .boolean()
    .optional()
    .describe('Flag indicating budget change.'),
  sl_change_flag: z
    .boolean()
    .optional()
    .describe('Flag indicating stop-loss change.'),
  n_window: z.number().optional().describe('Window size N.'),
  k_trigger_flag: z
    .boolean()
    .optional()
    .describe('Flag indicating K trigger.'),
});

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
      'Slow ROI Pacing (Low click velocity)',
      'Fast Budget Pacing (Aggressive Target increase)',
      'Fast ROI Pacing (Protection side)',
      'Low click volume for K-trigger',
      'Insufficient window size (N)',
      'Budget guardrail interference',
      'Auction limitations',
    ])
    .describe('The primary root cause of the performance issue.'),
  evidence: z
    .string()
    .describe('Evidence from the data supporting the diagnosis. Use SL ROI and ROI Target terms.'),
  recommendation: z
    .string()
    .describe('Recommended parameter/system change to address the issue.'),
  severity: z
    .enum(['Low', 'Medium', 'High'])
    .describe('The severity of the issue.'),
  severity_justification: z
    .string()
    .describe('Detailed reasoning for the chosen severity level at the catalog level.'),
});
export type DiagnoseBiddingOutput = z.infer<
  typeof DiagnoseBiddingOutputSchema
>;
