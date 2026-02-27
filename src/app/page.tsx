"use client";

import React, { useState } from 'react';
import { Brain, Settings2, BarChart3, Database, ShieldCheck } from 'lucide-react';
import { CsvUploader } from '@/components/bid-brain/csv-uploader';
import { AnalysisControls } from '@/components/bid-brain/analysis-controls';
import { ResultsView } from '@/components/bid-brain/results-view';
import { diagnoseBiddingPerformance } from '@/ai/flows/diagnose-bidding-performance';
import { DiagnoseBiddingOutput } from '@/ai/flows/diagnose-bidding-performance.schema';
import { Toaster } from '@/components/ui/toaster';
import { useToast } from '@/hooks/use-toast';

export default function BidBrainPage() {
  const [biddingData, setBiddingData] = useState<any[]>([]);
  const [analysisType, setAnalysisType] = useState<'Low BU Analysis' | 'Low Delivery Analysis'>('Low BU Analysis');
  const [pUp, setPUp] = useState<number>(0.1);
  const [pDown, setPDown] = useState<number>(0.2);
  const [results, setResults] = useState<DiagnoseBiddingOutput[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleRunAnalysis = async () => {
    if (biddingData.length === 0) return;

    setIsLoading(true);
    setResults([]);

    try {
      // Inject the manual p_up and p_down constants into each data row
      const enrichedData = biddingData.map(row => ({
        ...row,
        p_up: pUp,
        p_down: pDown
      }));

      const diagnosticResults = await diagnoseBiddingPerformance({
        analysisType,
        biddingData: enrichedData
      });
      setResults(diagnosticResults);
      
      if (diagnosticResults.length > 0) {
        toast({
          title: "Analysis Complete",
          description: `Successfully analyzed ${diagnosticResults.length} unique catalogs.`,
        });
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Analysis Error",
        description: error.message || "An unexpected error occurred during diagnostics.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <header className="border-b bg-white shadow-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground">
              <Brain className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold font-headline tracking-tight text-primary">
              BidBrain <span className="text-foreground">Analyzer</span>
            </h1>
          </div>
          <div className="flex items-center space-x-4 text-sm font-medium text-muted-foreground">
            <div className="flex items-center space-x-1">
              <Database className="w-4 h-4" />
              <span>CSV Data</span>
            </div>
            <div className="flex items-center space-x-1">
              <ShieldCheck className="w-4 h-4" />
              <span>Local Privacy</span>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-8 max-w-5xl">
        {/* Intro Section */}
        <section className="space-y-4">
          <div className="inline-flex items-center px-3 py-1 rounded-full bg-accent/10 text-accent text-xs font-bold uppercase tracking-wider">
            Bidding Performance Engine
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-bold font-headline text-foreground tracking-tight">
              Diagnostic Bidding Agent
            </h2>
            <p className="text-muted-foreground max-w-2xl text-lg">
              Analyze catalog-level performance using AI to pinpoint bidding inefficiencies and parameter drifts.
            </p>
          </div>
        </section>

        {/* Upload & Controls */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-12">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <CsvUploader
                onDataLoaded={setBiddingData}
                onClear={() => {
                  setBiddingData([]);
                  setResults([]);
                }}
              />
              <div className="space-y-4">
                <AnalysisControls
                  analysisType={analysisType}
                  onTypeChange={setAnalysisType}
                  onRunAnalysis={handleRunAnalysis}
                  isLoading={isLoading}
                  disabled={biddingData.length === 0}
                  pUp={pUp}
                  pDown={pDown}
                  onPUpChange={setPUp}
                  onPDownChange={setPDown}
                />
                
                <div className="p-4 rounded-xl border bg-card/40 text-xs text-muted-foreground flex items-start space-x-3 shadow-sm">
                  <div className="p-1.5 rounded-full bg-primary/10 text-primary shrink-0">
                    <Settings2 className="w-3.5 h-3.5" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-semibold text-foreground">Usage Guidelines</p>
                    <p>
                      Ensure your CSV columns match the requirement: <code>ts</code> for timestamp and <code>roi_min</code> for stop-loss ROI. Constants for <code>p_up</code> and <code>p_down</code> are applied globally across all catalogs in the current analysis.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Results */}
        <section className="space-y-6 pt-4">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-20 space-y-4 animate-in fade-in zoom-in-95 duration-300 bg-card rounded-2xl border border-border shadow-sm">
              <div className="relative">
                <BarChart3 className="w-12 h-12 text-primary/20 animate-pulse" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                </div>
              </div>
              <div className="text-center space-y-1">
                <p className="font-bold text-xl font-headline">Processing AI Diagnostics</p>
                <p className="text-sm text-muted-foreground">Cross-referencing ROI trends and budget utilization patterns...</p>
              </div>
            </div>
          )}

          {!isLoading && results.length > 0 && (
            <ResultsView results={results} analysisType={analysisType} />
          )}

          {!isLoading && results.length === 0 && biddingData.length > 0 && (
            <div className="py-20 text-center border border-dashed rounded-2xl bg-muted/20">
              <BarChart3 className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
              <p className="text-muted-foreground font-medium text-lg">Ready to diagnose {biddingData.length} data points.</p>
              <p className="text-sm text-muted-foreground/60 mt-1">Configure your parameters and click "Run Diagnostics".</p>
            </div>
          )}
        </section>
      </main>

      <Toaster />
    </div>
  );
}
