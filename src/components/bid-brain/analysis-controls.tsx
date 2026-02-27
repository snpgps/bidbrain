"use client";

import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlayCircle, Loader2, SlidersHorizontal, Settings2 } from 'lucide-react';

interface AnalysisControlsProps {
  analysisType: 'Low BU Analysis' | 'Low Delivery Analysis';
  onTypeChange: (type: 'Low BU Analysis' | 'Low Delivery Analysis') => void;
  onRunAnalysis: () => void;
  isLoading: boolean;
  disabled: boolean;
  pUp: number;
  pDown: number;
  onPUpChange: (val: number) => void;
  onPDownChange: (val: number) => void;
  nWindow: number;
  onNWindowChange: (val: number) => void;
  kTrigger: number;
  onKTriggerChange: (val: number) => void;
}

export function AnalysisControls({
  analysisType,
  onTypeChange,
  onRunAnalysis,
  isLoading,
  disabled,
  pUp,
  pDown,
  onPUpChange,
  onPDownChange,
  nWindow,
  onNWindowChange,
  kTrigger,
  onKTriggerChange,
}: AnalysisControlsProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-card p-4 rounded-xl border border-border shadow-sm">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Analysis Type</label>
          <Select
            value={analysisType}
            onValueChange={(val: any) => onTypeChange(val)}
            disabled={isLoading || disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose analysis type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Low BU Analysis">Low BU Analysis</SelectItem>
              <SelectItem value="Low Delivery Analysis">Low Delivery Analysis</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end">
          <Button
            onClick={onRunAnalysis}
            disabled={isLoading || disabled}
            size="lg"
            className="w-full font-bold shadow-sm"
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
      </div>

      <div className="bg-muted/30 p-4 rounded-xl border border-dashed space-y-4">
        <div className="flex items-center space-x-2 text-muted-foreground">
          <SlidersHorizontal className="w-4 h-4" />
          <span className="text-sm font-medium">Bidding Constants</span>
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase">p_up</label>
            <Input
              type="number"
              step="0.01"
              value={pUp}
              onChange={(e) => onPUpChange(parseFloat(e.target.value) || 0)}
              disabled={isLoading || disabled}
              className="h-9 bg-background"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase">p_down</label>
            <Input
              type="number"
              step="0.01"
              value={pDown}
              onChange={(e) => onPDownChange(parseFloat(e.target.value) || 0)}
              disabled={isLoading || disabled}
              className="h-9 bg-background"
            />
          </div>
        </div>

        <div className="pt-2 flex items-center space-x-2 text-muted-foreground">
          <Settings2 className="w-4 h-4" />
          <span className="text-sm font-medium">Reliability & Triggers</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase">N (Window size)</label>
            <Input
              type="number"
              value={nWindow}
              onChange={(e) => onNWindowChange(parseInt(e.target.value) || 0)}
              disabled={isLoading || disabled}
              className="h-9 bg-background"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase">K (Trigger clicks)</label>
            <Input
              type="number"
              value={kTrigger}
              onChange={(e) => onKTriggerChange(parseInt(e.target.value) || 0)}
              disabled={isLoading || disabled}
              className="h-9 bg-background"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
