"use client";

import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { PlayCircle, Loader2 } from 'lucide-react';

interface AnalysisControlsProps {
  analysisType: 'Low BU Analysis' | 'Low Delivery Analysis';
  onTypeChange: (type: 'Low BU Analysis' | 'Low Delivery Analysis') => void;
  onRunAnalysis: () => void;
  isLoading: boolean;
  disabled: boolean;
}

export function AnalysisControls({
  analysisType,
  onTypeChange,
  onRunAnalysis,
  isLoading,
  disabled
}: AnalysisControlsProps) {
  return (
    <div className="flex flex-col sm:flex-row items-end sm:items-center gap-4 bg-card p-4 rounded-xl border border-border shadow-sm">
      <div className="flex-1 space-y-1.5 w-full">
        <label className="text-sm font-medium text-muted-foreground">Select Analysis Type</label>
        <Select
          value={analysisType}
          onValueChange={(val: any) => onTypeChange(val)}
          disabled={isLoading || disabled}
        >
          <SelectTrigger className="w-full sm:w-[240px]">
            <SelectValue placeholder="Choose analysis type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Low BU Analysis">Low BU Analysis</SelectItem>
            <SelectItem value="Low Delivery Analysis">Low Delivery Analysis</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      <Button
        onClick={onRunAnalysis}
        disabled={isLoading || disabled}
        size="lg"
        className="w-full sm:w-auto min-w-[160px] font-semibold"
      >
        {isLoading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Analyzing...
          </>
        ) : (
          <>
            <PlayCircle className="mr-2 h-4 w-4" />
            Run Diagnostics
          </>
        )}
      </Button>
    </div>
  );
}
