"use client";

import React, { useCallback, useState } from 'react';
import { Upload, FileText, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { parseBiddingCsv as parseUtils } from '@/lib/csv-utils';

interface CsvUploaderProps {
  onDataLoaded: (data: any[], file?: File) => void;
  onClear: () => void;
}

export function CsvUploader({ onDataLoaded, onClear }: CsvUploaderProps) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rowCount, setRowCount] = useState<number>(0);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const data = parseUtils(text);
        setRowCount(data.length);
        onDataLoaded(data, file);
      } catch (err: any) {
        setError(err.message || 'Failed to parse CSV');
        onClear();
      }
    };
    reader.onerror = () => {
      setError('Error reading file');
      onClear();
    };
    reader.readAsText(file);
  }, [onDataLoaded, onClear]);

  const clearFile = () => {
    setFileName(null);
    setRowCount(0);
    setError(null);
    onClear();
  };

  return (
    <Card className="p-8 border-dashed border-2 bg-card/50 transition-all hover:bg-card/80">
      <div className="flex flex-col items-center justify-center text-center space-y-4">
        {!fileName ? (
          <>
            <div className="p-4 rounded-full bg-primary/10 text-primary">
              <Upload className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-lg font-semibold">Upload Bidding Data</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Drop your CSV file here or click to browse.
              </p>
            </div>
            <label className="cursor-pointer">
              <Button variant="outline" asChild>
                <span>Select CSV</span>
              </Button>
              <input
                type="file"
                className="hidden"
                accept=".csv"
                onChange={handleFileUpload}
              />
            </label>
          </>
        ) : (
          <div className="w-full flex items-center justify-between p-4 bg-background rounded-lg border border-border">
            <div className="flex items-center space-x-4">
              <div className={`p-2 rounded-md ${error ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
                {error ? <AlertCircle className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
              </div>
              <div className="text-left">
                <p className="text-sm font-medium">{fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {error ? error : `${rowCount} rows loaded`}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={clearFile} className="h-8 w-8">
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
