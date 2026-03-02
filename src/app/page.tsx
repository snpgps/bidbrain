"use client";

import React, { useState } from 'react';
import { Brain, Settings2, BarChart3, Database, ShieldCheck, AlertCircle } from 'lucide-react';
import { CsvUploader } from '@/components/bid-brain/csv-uploader';
import { AnalysisControls } from '@/components/bid-brain/analysis-controls';
import { ResultsView } from '@/components/bid-brain/results-view';
import { diagnoseBiddingPerformance } from '@/ai/flows/diagnose-bidding-performance';
import { DiagnoseBiddingOutput } from '@/ai/flows/diagnose-bidding-performance.schema';
import { Toaster } from '@/components/ui/toaster';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export default function BidBrainPage() {
  const [biddingData, setBiddingData] = useState<any[]>([]);
  const [analysisType, setAnalysisType] = useState<'Low BU Analysis' | 'Low Delivery Analysis'>('Low BU Analysis');
  const [pUp, setPUp] = useState<number>(0.1);
  const [pDown, setPDown] = useState<number>(0.2);
  const [nWindow, setNWindow] = useState<number>(1800);
  const [kTrigger, setKTrigger] = useState<number>(360);
  const [results, setResults] = useState<DiagnoseBiddingOutput[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRunAnalysis = async () => {
    if (biddingData.length === 0) return;

    setIsLoading(true);
    setResults([]);
    setError(null);

    try {
      // Inject the manual p_up and p_down constants into each data row
      const enrichedData = biddingData.map(row => ({
        ...row,
        p_up: pUp,
        p_down: pDown
      }));

      const diagnosticResults = await diagnoseBiddingPerformance({
        analysisType,
        biddingData: enrichedData,
        nWindow,
        kTrigger
      });
      
      if (!diagnosticResults || diagnosticResults.length === 0) {
        throw new Error("The AI returned no analysis results. This might happen if the data for the selected period is insufficient or the AI could not confirm any issues.");
      }

      setResults(diagnosticResults);
    } catch (err: any) {
      console.error("Diagnostic Run Error:", err);
      setError(err.message || "An unexpected error occurred during AI diagnostics.");
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

        {/* Error Display */}
        {error && (
          <Alert variant="destructive" className="bg-destructive/5 border-destructive/20 animate-in fade-in slide-in-from-top-2">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle className="font-bold">Analysis Failed</AlertTitle>
            <AlertDescription className="space-y-3">
              <p className="text-sm opacity-90">{error}</p>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleRunAnalysis}
                className="bg-white hover:bg-destructive/10 border-destructive/30 text-destructive h-8 font-semibold"
              >
                Retry Analysis
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Upload & Controls */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-12">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <CsvUploader
                onDataLoaded={(data) => {
                  setBiddingData(data);
                  setError(null);
                  setResults([]);
                }}
                onClear={() => {
                  setBiddingData([]);
                  setResults([]);
                  setError(null);
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
                  nWindow={nWindow}
                  onNWindowChange={setNWindow}
                  kTrigger={kTrigger}
                  onKTriggerChange={setKTrigger}
                />
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
                <p className="font-bold text-xl font-headline text-primary">AI Diagnostic in Progress</p>
                <p className="text-sm text-muted-foreground">This may take up to 30 seconds depending on the data volume.</p>
              </div>
            </div>
          )}

          {!isLoading && results.length > 0 && (
            <ResultsView 
              results={results} 
              analysisType={analysisType} 
              originalData={biddingData}
            />
          )}

          {!isLoading && results.length === 0 && !error && biddingData.length > 0 && (
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
