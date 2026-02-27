import { DiagnoseBiddingOutput } from '@/ai/flows/diagnose-bidding-performance.schema';

export const REQUIRED_COLUMNS = [
  'catalog_id',
  'ts',
  'catalog_roi',
  'roi_target',
  'roi_min',
  'catalog_clicks',
  'catalog_gmv',
  'catalog_bu_perc',
  'bu_ideal',
  'day_roi',
  'catalog_bugdet_utilised',
  'alpha',
];

export function parseBiddingCsv(csvText: string): any[] {
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => h.trim());
  const missing = REQUIRED_COLUMNS.filter((col) => !headers.includes(col));

  if (missing.length > 0) {
    throw new Error(`Missing required columns: ${missing.join(', ')}`);
  }

  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim());
    const row: any = {};
    headers.forEach((header, index) => {
      const val = values[index];
      
      // Map incoming CSV headers to schema keys
      let schemaKey = header;
      if (header === 'ts') schemaKey = 'timestamp';
      if (header === 'roi_min') schemaKey = 'sl_roi';
      if (header === 'catalog_bugdet_utilised') schemaKey = 'spend';

      // Convert numeric fields
      if (
        [
          'catalog_roi',
          'roi_target',
          'sl_roi', // mapped from roi_min
          'roi_min', // incoming
          'catalog_clicks',
          'catalog_gmv',
          'catalog_bu_perc',
          'bu_ideal',
          'day_roi',
          'spend', // mapped from catalog_bugdet_utilised
          'catalog_bugdet_utilised', // incoming
          'alpha',
          'p_up',
          'p_down',
          'n_window',
        ].includes(schemaKey)
      ) {
        row[schemaKey] = parseFloat(val) || 0;
      } else if (['budget_change_flag', 'sl_change_flag', 'k_trigger_flag'].includes(schemaKey)) {
        row[schemaKey] = val.toLowerCase() === 'true';
      } else {
        row[schemaKey] = val;
      }
    });
    results.push(row);
  }
  return results;
}

export function exportResultsToCsv(results: any[], analysisType: string) {
  if (results.length === 0) return;

  const headers = ['catalog_id', 'issue_type', 'issue_confirmed', 'root_cause', 'severity', 'evidence', 'recommendation'];
  const csvRows = [headers.join(',')];

  results.forEach((res) => {
    const row = [
      res.catalog_id,
      analysisType,
      res.issue_confirmed,
      `"${res.root_cause.replace(/"/g, '""')}"`,
      res.severity,
      `"${res.evidence.replace(/"/g, '""')}"`,
      `"${res.recommendation.replace(/"/g, '""')}"`,
    ];
    csvRows.push(row.join(','));
  });

  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.setAttribute('hidden', '');
  a.setAttribute('href', url);
  a.setAttribute('download', `bidbrain_analysis_${new Date().toISOString()}.csv`);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
