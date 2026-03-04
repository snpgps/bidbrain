"use client";

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Brain, BarChart3, AlertCircle, History, Loader2, LogIn, LogOut, User as UserIcon, Terminal, Zap } from 'lucide-react';
import { CsvUploader } from '@/components/bid-brain/csv-uploader';
import { AnalysisControls } from '@/components/bid-brain/analysis-controls';
import { ResultsView } from '@/components/bid-brain/results-view';
import { analyzeCatalogAction } from '@/ai/flows/diagnose-bidding-performance';
import { DiagnoseBiddingOutput } from '@/ai/flows/diagnose-bidding-performance.schema';
import { Toaster } from '@/components/ui/toaster';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useFirestore, useUser, useStorage, useAuth } from '@/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

type LogEntry = {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
};

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
  const scrollRef = useRef<HTMLDivElement>(null);

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
    try {
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      setError("Failed to sign in: " + err.message);
    }
  };

  const handleSignOut = async () => {
    if (!auth) return;
    await signOut(auth);
  };

  const handleRunAnalysis = async () => {
    if ((!selectedFile && biddingData.length === 0) || !db || !storage) {
      setError("Please upload a file or data before running diagnostics.");
      return;
    }

    setIsLoading(true);
    setResults([]);
    setError(null);
    setLogs([]);

    const newSessionId = crypto.randomUUID();
    addLog(`Initialized Parallel Diagnostic Engine: ${newSessionId}`, 'info');

    try {
      let fileUrl = '';
      if (selectedFile) {
        addLog(`Persisting source file to Cloud Storage...`, 'info');
        const storageRef = ref(storage, `uploads/${newSessionId}/${selectedFile.name}`);
        const uploadResult = await uploadBytes(storageRef, selectedFile);
        fileUrl = await getDownloadURL(uploadResult.ref);
      }

      const sessionRef = doc(db, 'analysis_sessions', newSessionId);
      const sessionData = {
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
        userId: user?.uid || 'anonymous'
      };

      await setDoc(sessionRef, sessionData);
      addLog(`Session record created. Starting multi-threaded analysis...`, 'success');

      // Group data by Catalog ID
      const catalogDataMap = new Map<string, any[]>();
      for (const row of biddingData) {
        if (!row.catalog_id) continue;
        if (!catalogDataMap.has(row.catalog_id)) {
          catalogDataMap.set(row.catalog_id, []);
        }
        catalogDataMap.get(row.catalog_id)?.push(row);
      }

      // Limit to 200 catalogs for safety, process in batches of 5 for speed
      const catalogIds = Array.from(catalogDataMap.keys()).slice(0, 200);
      const BATCH_SIZE = 5;
      const finalResults: DiagnoseBiddingOutput[] = [];

      addLog(`Processing ${catalogIds.length} catalogs in parallel batches of ${BATCH_SIZE}...`, 'info');

      for (let i = 0; i < catalogIds.length; i += BATCH_SIZE) {
        const batch = catalogIds.slice(i, i + BATCH_SIZE);
        addLog(`Spinning up thread batch ${Math.floor(i / BATCH_SIZE) + 1}...`, 'info');

        const batchPromises = batch.map(async (catalogId) => {
          try {
            const result = await analyzeCatalogAction({
              analysisType,
              catalogId,
              catalogData: catalogDataMap.get(catalogId) || [],
              pUp,
              pDown,
              nWindow,
              kTrigger
            });

            if (result) {
              // Immediate persistence for each successful catalog
              const resultRef = doc(db, 'analysis_sessions', newSessionId, 'results', catalogId);
              setDoc(resultRef, { ...result, timestamp: new Date().toISOString() });
              
              addLog(`Analyzed ${catalogId} successfully.`, 'success');
              return result;
            }
          } catch (err: any) {
            addLog(`Error on catalog ${catalogId}: ${err.message}`, 'error');
            return null;
          }
          return null;
        });

        const batchResults = await Promise.all(batchPromises);
        const validResults = batchResults.filter((r): r is DiagnoseBiddingOutput => r !== null);
        
        finalResults.push(...validResults);
        setResults(prev => [...prev, ...validResults]);

        // Small delay between batches to respect RPM
        if (i + BATCH_SIZE < catalogIds.length) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }

      await setDoc(sessionRef, { status: 'completed' }, { merge: true });
      addLog(`Analysis Complete. ${finalResults.length}/${catalogIds.length} catalogs processed successfully.`, 'success');

    } catch (err: any) {
      console.error("Batch Error:", err);
      setError(err.message || "An unexpected error occurred.");
      addLog(`FATAL BATCH ERROR: ${err.message}`, 'error');
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
            <Button variant="ghost" size="sm" asChild className="text-muted-foreground hidden sm:flex">
              <Link href="/history">
                <History className="w-4 h-4 mr-2" />
                History
              </Link>
            </Button>
            <div className="h-4 w-px bg-border hidden sm:block"></div>
            
            {user ? (
              <div className="flex items-center space-x-3">
                <div className="hidden md:block text-right">
                  <p className="text-xs font-bold text-foreground leading-none">{user.displayName}</p>
                </div>
                <Avatar className="h-8 w-8 border">
                  <AvatarImage src={user.photoURL || ''} />
                  <AvatarFallback><UserIcon className="w-4 h-4" /></AvatarFallback>
                </Avatar>
                <Button variant="outline" size="icon" onClick={handleSignOut} className="h-8 w-8 text-muted-foreground hover:text-destructive">
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <Button size="sm" onClick={handleSignIn} className="font-bold">
                <LogIn className="w-4 h-4 mr-2" />
                Sign In
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-8 max-w-5xl">
        <section className="space-y-4">
          <div className="inline-flex items-center px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 text-xs font-bold uppercase tracking-wider">
            <Zap className="w-3 h-3 mr-1.5" /> Parallel Engine Active
          </div>
          <h2 className="text-3xl font-bold font-headline text-foreground tracking-tight">
            High-Throughput Diagnostic Agent
          </h2>
        </section>

        {error && (
          <Alert variant="destructive" className="bg-destructive/5 border-destructive/20">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle className="font-bold">Process Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-12">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <CsvUploader
                onDataLoaded={(data, file) => {
                  setBiddingData(data);
                  setSelectedFile(file || null);
                  setError(null);
                  setResults([]);
                }}
                onClear={() => {
                  setBiddingData([]);
                  setSelectedFile(null);
                  setResults([]);
                  setError(null);
                }}
              />
              <AnalysisControls
                analysisType={analysisType}
                onTypeChange={setAnalysisType}
                onRunAnalysis={handleRunAnalysis}
                isLoading={isLoading}
                disabled={biddingData.length === 0 && !selectedFile}
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
        </section>

        <section className="space-y-6">
          {isLoading && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-7 flex flex-col items-center justify-center py-20 space-y-4 bg-card rounded-2xl border border-border shadow-sm">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
                <div className="text-center">
                  <p className="font-bold text-xl text-primary">Parallel Processing Live</p>
                  <p className="text-sm text-muted-foreground">Executing batch threads and persisting results...</p>
                  <div className="mt-4 text-xs font-mono bg-muted px-2 py-1 rounded">
                    Batch Progress: {results.length} catalogs saved
                  </div>
                </div>
              </div>
              
              <div className="lg:col-span-5">
                <Card className="bg-slate-950 border-slate-800 shadow-xl">
                  <div className="bg-slate-900 px-4 py-2 border-b border-slate-800 flex items-center space-x-2">
                    <Terminal className="w-4 h-4 text-emerald-400" />
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Process Logs</span>
                  </div>
                  <ScrollArea className="h-[300px] p-4 font-code text-[11px]">
                    <div className="space-y-1.5">
                      {logs.map((log, i) => (
                        <div key={i} className="flex space-x-3">
                          <span className="text-slate-500 whitespace-nowrap">{log.timestamp}</span>
                          <span className={
                            log.type === 'success' ? 'text-emerald-400' :
                            log.type === 'error' ? 'text-rose-400' :
                            'text-slate-300'
                          }>
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
                {biddingData.length > 0 ? `Ready to analyze ${biddingData.length} rows` : 'Upload data to begin'}
              </p>
            </div>
          )}
        </section>
      </main>

      <Toaster />
    </div>
  );
}
