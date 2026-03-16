
"use client";

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Brain, BarChart3, AlertCircle, History, Loader2, LogIn, LogOut, User as UserIcon, Terminal, Settings2, Sparkles } from 'lucide-react';
import { CsvUploader } from '@/components/bid-brain/csv-uploader';
import { AnalysisControls } from '@/components/bid-brain/analysis-controls';
import { ResultsView } from '@/components/bid-brain/results-view';
import { PromptEditor } from '@/components/bid-brain/prompt-editor';
import { analyzeCatalogAction } from '@/ai/flows/diagnose-bidding-performance';
import { DiagnoseBiddingOutput } from '@/ai/flows/diagnose-bidding-performance.schema';
import { Toaster } from '@/components/ui/toaster';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useFirestore, useUser, useStorage, useAuth, useDoc } from '@/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

type LogEntry = {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
};

const DEFAULT_SYSTEM_PROMPT = `You are a senior Ads Bidding PM. You are diagnosing a bidding control system.

CORE CONTROL LOGIC:
1. ROI Pacing: If Catalog_ROI > SL_ROI and BU < BU Ideal, REDUCE ROI_Target to scale.
2. Protection: If Catalog_ROI < SL_ROI, INCREASE ROI_Target rapidly (P_down) to protect margins.
3. Reliability: Window N = {{{nWindow}}} clicks. Update Trigger K = {{{kTrigger}}} clicks.

DIAGNOSIS CATEGORIES (ROOT CAUSE):
- Slow ROI Pacing: ROI Target is high and moving slowly.
- Fast Budget Pacing: ROI target increased too rapidly.
- Fast ROI Pacing (protection side): High spike in ROI Target during a low-ROI period.
- Outlier Day / Performance Death Loop: Spend behaved differently leading to low ROI, causing a drop in Catalog ROI and a persistent ROI target increase.
- Incorrect Catalog ROI Window: Large N causes lag. Day ROI is high, but Catalog ROI remains low.
- Low click volume for K-trigger: Total daily clicks < K trigger.
- Campaign status issues: Paused or inactive.

ANALYSIS TASKS:
1. Aggregate clicks across all campaign buckets for the day.
2. If Catalog_ROI is consistently below SL_ROI, check for "Outlier Day" spikes that triggered "Performance Death Loop".
3. Use SL ROI and ROI Target terms in evidence. Reference AGGREGATE daily clicks.`;

const DEFAULT_USER_PROMPT = `Analysis Type: {{{analysisType}}}
Constants: P_up = {{{pUp}}}, P_down = {{{pDown}}}, N = {{{nWindow}}}, K = {{{kTrigger}}}

Catalog Data:
{{{catalogDataJson}}}

Return JSON matching the schema.`;

export default function BidBrainPage() {
  const db = useFirestore();
  const storage = useStorage();
  const auth = useAuth();
  const { user } = useUser();
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [biddingData, setBiddingData] = useState<any[]>([]);
  const [analysisType, setAnalysisType] = useState<'Low BU Analysis' | 'Low Delivery Analysis'>('Low BU Analysis');
  const [pUp, setPUp] = useState<number>(0.1);
  const [pDown, setPDown] = useState<number>(0.2);
  const [nWindow, setNWindow] = useState<number>(1800);
  const [kTrigger, setKTrigger] = useState<number>(360);
  const [results, setResults] = useState<DiagnoseBiddingOutput[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  // Prompt State
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [userPrompt, setUserPrompt] = useState(DEFAULT_USER_PROMPT);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Sync prompts from Firestore
  const promptRef = React.useMemo(() => (db ? doc(db, 'prompts', 'bidding_analysis') : null), [db]);
  const { data: savedPrompt } = useDoc(promptRef);

  useEffect(() => {
    if (savedPrompt) {
      if (savedPrompt.systemPrompt) setSystemPrompt(savedPrompt.systemPrompt);
      if (savedPrompt.userPrompt) setUserPrompt(savedPrompt.userPrompt);
    }
  }, [savedPrompt]);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [...prev, {
      timestamp: new Date().toLocaleTimeString(),
      message,
      type
    }]);
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const handleSignIn = async () => {
    if (!auth) return;
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const handleSignOut = async () => {
    if (!auth) return;
    await signOut(auth);
  };

  const handleRunAnalysis = async () => {
    if ((!selectedFile && biddingData.length === 0) || !db || !storage) {
      setError("Please upload data before running diagnostics.");
      return;
    }

    setIsLoading(true);
    setResults([]);
    setError(null);
    setLogs([]);

    const newSessionId = crypto.randomUUID();
    addLog(`Initialized Engine: ${newSessionId}`, 'info');

    try {
      let fileUrl = '';
      if (selectedFile) {
        addLog(`Uploading source file...`, 'info');
        const storageRef = ref(storage, `uploads/${newSessionId}/${selectedFile.name}`);
        const uploadResult = await uploadBytes(storageRef, selectedFile);
        fileUrl = await getDownloadURL(uploadResult.ref);
      }

      const sessionRef = doc(db, 'analysis_sessions', newSessionId);
      await setDoc(sessionRef, {
        id: newSessionId,
        fileName: selectedFile?.name || 'Manual Paste',
        status: 'processing',
        createdAt: serverTimestamp(),
        fileUrl,
        analysisType,
        pUp,
        pDown,
        nWindow,
        kTrigger,
        userId: user?.uid || 'anonymous',
        systemPrompt,
        userPrompt
      });

      // Group data by Catalog ID
      const catalogDataMap = new Map<string, any[]>();
      for (const row of biddingData) {
        if (!row.catalog_id) continue;
        if (!catalogDataMap.has(row.catalog_id)) {
          catalogDataMap.set(row.catalog_id, []);
        }
        catalogDataMap.get(row.catalog_id)?.push(row);
      }

      const catalogIds = Array.from(catalogDataMap.keys());
      addLog(`Analyzing ${catalogIds.length} catalogs in parallel threads...`, 'info');

      // Concurrent processing with workers
      const CONCURRENCY_LIMIT = 5;
      const queue = [...catalogIds];
      const activeWorkers = new Set();
      const finalResults: DiagnoseBiddingOutput[] = [];

      const runWorker = async () => {
        while (queue.length > 0) {
          const catalogId = queue.shift();
          if (!catalogId) break;

          activeWorkers.add(catalogId);
          try {
            const result = await analyzeCatalogAction({
              analysisType,
              catalogId,
              catalogData: catalogDataMap.get(catalogId) || [],
              pUp,
              pDown,
              nWindow,
              kTrigger,
              systemPrompt,
              userPrompt
            });

            if (result) {
              const resultRef = doc(db, 'analysis_sessions', newSessionId, 'results', catalogId);
              setDoc(resultRef, { ...result, timestamp: new Date().toISOString() });
              
              setResults(prev => [...prev, result]);
              finalResults.push(result);
              addLog(`Analyzed ${catalogId} [SUCCESS]`, 'success');
            }
          } catch (err: any) {
            addLog(`Failed ${catalogId}: ${err.message}`, 'error');
          } finally {
            activeWorkers.delete(catalogId);
          }
          await new Promise(r => setTimeout(r, 100));
        }
      };

      const workers = Array(Math.min(catalogIds.length, CONCURRENCY_LIMIT))
        .fill(null)
        .map(() => runWorker());

      await Promise.all(workers);

      await setDoc(sessionRef, { status: 'completed' }, { merge: true });
      addLog(`Session Complete. Results stored.`, 'success');

    } catch (err: any) {
      setError(err.message);
      addLog(`FATAL: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="border-b bg-white shadow-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Link href="/" className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground">
                <Brain className="w-5 h-5" />
              </div>
              <h1 className="text-xl font-bold font-headline tracking-tight text-primary">
                BidBrain <span className="text-foreground">Analyzer</span>
              </h1>
            </Link>
          </div>
          <div className="flex items-center space-x-4">
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
              <Link href="/history">
                <History className="w-4 h-4 mr-2" />
                History
              </Link>
            </Button>
            {user ? (
              <div className="flex items-center space-x-3">
                <Avatar className="h-8 w-8 border">
                  <AvatarImage src={user.photoURL || ''} />
                  <AvatarFallback><UserIcon className="w-4 h-4" /></AvatarFallback>
                </Avatar>
                <Button variant="outline" size="icon" onClick={handleSignOut} className="h-8 w-8">
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <Button size="sm" onClick={handleSignIn}>
                <LogIn className="w-4 h-4 mr-2" />
                Sign In
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-8 max-w-5xl">
        <section className="space-y-2">
          <h2 className="text-3xl font-bold font-headline text-foreground tracking-tight">
            Diagnostic Dashboard
          </h2>
        </section>

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="analysis" className="space-y-6">
          <TabsList className="grid w-[400px] grid-cols-2">
            <TabsTrigger value="analysis" className="flex items-center">
              <Sparkles className="w-4 h-4 mr-2" />
              Run Analysis
            </TabsTrigger>
            <TabsTrigger value="prompt" className="flex items-center">
              <Settings2 className="w-4 h-4 mr-2" />
              AI Instructions
            </TabsTrigger>
          </TabsList>

          <TabsContent value="analysis" className="space-y-8">
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <CsvUploader
                onDataLoaded={(data, file) => {
                  setBiddingData(data);
                  setSelectedFile(file || null);
                }}
                onClear={() => {
                  setBiddingData([]);
                  setSelectedFile(null);
                }}
              />
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
            </section>

            <section className="space-y-6">
              {isLoading && (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                  <div className="lg:col-span-7 flex flex-col items-center justify-center py-20 bg-card rounded-2xl border border-border shadow-sm">
                    <Loader2 className="w-10 h-10 text-primary animate-spin" />
                    <p className="mt-4 font-bold text-xl text-primary">AI Analysis In Progress</p>
                    <p className="text-sm text-muted-foreground">Processing catalogs using parallel threads...</p>
                    <div className="mt-4 text-xs font-mono bg-muted px-2 py-1 rounded">
                      Completed: {results.length} / {new Set(biddingData.map(d => d.catalog_id)).size}
                    </div>
                  </div>
                  <div className="lg:col-span-5">
                    <Card className="bg-slate-950 border-slate-800 shadow-xl">
                      <div className="bg-slate-900 px-4 py-2 border-b border-slate-800 flex items-center space-x-2">
                        <Terminal className="w-3 h-3 text-emerald-400" />
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Execution Logs</span>
                      </div>
                      <ScrollArea className="h-[300px] p-4 font-code text-[11px]">
                        <div className="space-y-1.5">
                          {logs.map((log, i) => (
                            <div key={i} className="flex space-x-3">
                              <span className="text-slate-500 whitespace-nowrap">{log.timestamp}</span>
                              <span className={log.type === 'success' ? 'text-emerald-400' : log.type === 'error' ? 'text-rose-400' : 'text-slate-300'}>
                                {log.message}
                              </span>
                            </div>
                          ))}
                          <div ref={scrollRef} />
                        </div>
                      </ScrollArea>
                    </Card>
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

              {!isLoading && results.length === 0 && (
                <div className="py-20 text-center border border-dashed rounded-2xl bg-muted/20">
                  <BarChart3 className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
                  <p className="text-muted-foreground font-medium text-lg">
                    {biddingData.length > 0 ? `Ready to analyze ${biddingData.length} data points` : 'Upload CSV data to start diagnostics'}
                  </p>
                </div>
              )}
            </section>
          </TabsContent>

          <TabsContent value="prompt">
            <PromptEditor 
              systemPrompt={systemPrompt}
              setSystemPrompt={setSystemPrompt}
              userPrompt={userPrompt}
              setUserPrompt={setUserPrompt}
              onRestoreDefaults={() => {
                setSystemPrompt(DEFAULT_SYSTEM_PROMPT);
                setUserPrompt(DEFAULT_USER_PROMPT);
              }}
              isLoading={isLoading}
            />
          </TabsContent>
        </Tabs>
      </main>

      <Toaster />
    </div>
  );
}
