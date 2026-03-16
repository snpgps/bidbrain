import { DiagnoseBiddingOutput } from '@/ai/flows/diagnose-bidding-performance.schema';

export const CORE_COLUMNS = [
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
  
  // More resilient header mapping for timestamp
  const timestampHeader = headers.find(h => ['ts', 'timestamp', 'date', 'Date', 'TS'].includes(h));
  
  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim());
    if (values.length < headers.length) continue;

    const row: any = {};
    headers.forEach((header, index) => {
      const val = values[index];
      
      let schemaKey = header;
      if (header === timestampHeader) schemaKey = 'timestamp';
      if (header === 'roi_min') schemaKey = 'sl_roi';
      if (header === 'catalog_bugdet_utilised') schemaKey = 'spend';

      const numericFields = [
        'catalog_roi',
        'roi_target',
        'sl_roi',
        'roi_min',
        'catalog_clicks',
        'catalog_gmv',
        'catalog_bu_perc',
        'bu_ideal',
        'day_roi',
        'spend',
        'catalog_bugdet_utilised',
        'alpha',
        'budget',
      ];

      if (numericFields.includes(schemaKey)) {
        row[schemaKey] = parseFloat(val) || 0;
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

  const headers = ['catalog_id', 'issue_type', 'issue_confirmed', 'root_cause', 'severity', 'evidence', 'l2_reason', 'severity_justification', 'recommendation'];
  const csvRows = [headers.join(',')];

  results.forEach((res) => {
    const row = [
      res.catalog_id,
      analysisType,
      res.issue_confirmed,
      `"${res.root_cause.replace(/"/g, '""')}"`,
      res.severity,
      `"${res.evidence.replace(/"/g, '""')}"`,
      `"${res.l2_reason.replace(/"/g, '""')}"`,
      `"${res.severity_justification.replace(/"/g, '""')}"`,
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
