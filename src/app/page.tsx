"use client";

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Brain, Settings2, BarChart3, Database, ShieldCheck, AlertCircle, History, Loader2, LogIn, LogOut, User as UserIcon, Terminal, CheckCircle2 } from 'lucide-react';
import { CsvUploader } from '@/components/bid-brain/csv-uploader';
import { AnalysisControls } from '@/components/bid-brain/analysis-controls';
import { ResultsView } from '@/components/bid-brain/results-view';
import { diagnoseBiddingPerformance } from '@/ai/flows/diagnose-bidding-performance';
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
    if ((!selectedFile && biddingData.length === 0) || !db || !storage) return;

    setIsLoading(true);
    setResults([]);
    setError(null);
    setLogs([]);

    const newSessionId = crypto.randomUUID();
    addLog(`Initialized new diagnostic session: ${newSessionId}`, 'info');

    try {
      let fileUrl = '';
      if (selectedFile) {
        addLog(`Uploading file: ${selectedFile.name}...`, 'info');
        const storageRef = ref(storage, `uploads/${newSessionId}/${selectedFile.name}`);
        const uploadResult = await uploadBytes(storageRef, selectedFile);
        fileUrl = await getDownloadURL(uploadResult.ref);
        addLog(`File uploaded successfully to Storage.`, 'success');
      }

      const sessionRef = doc(db, 'analysis_sessions', newSessionId);
      const sessionData = {
        id: newSessionId,
        fileName: selectedFile?.name || 'Manual Paste',
        status: 'processing',
        createdAt: serverTimestamp(),
        fileUrl: fileUrl,
        analysisType,
        pUp,
        pDown,
        nWindow,
        kTrigger,
        userId: user?.uid || 'anonymous'
      };

      await setDoc(sessionRef, sessionData).catch(async (e) => {
        errorEmitter.emit('permission-error', new FirestorePermissionError({
          path: sessionRef.path,
          operation: 'create',
          requestResourceData: sessionData,
        }));
      });
      addLog(`Session record created in Firestore.`, 'success');

      addLog(`Handoff to Backend: Analyzing catalogs in robust batch...`, 'info');
      addLog(`(This avoids large body payload issues and handles retries)`, 'warning');

      // OPTIMIZATION: If we have a fileUrl, we don't send the raw biddingData array to avoid 1MB body limit
      const batchResults = await diagnoseBiddingPerformance({
        analysisType,
        biddingData: fileUrl ? [] : (biddingData.length > 0 ? biddingData : []),
        fileUrl: fileUrl,
        nWindow,
        kTrigger,
        pUp,
        pDown,
        sessionId: newSessionId
      });

      if (batchResults && batchResults.length > 0) {
        setResults(batchResults);
        addLog(`Successfully analyzed ${batchResults.length} catalogs on the backend.`, 'success');
        
        setDoc(sessionRef, { status: 'completed' }, { merge: true });
        addLog(`Session completed. All diagnostics stored.`, 'success');
      } else {
        throw new Error("No results were generated. AI engine might have hit a fatal quota or timeout.");
      }

    } catch (err: any) {
      console.error("Diagnostic Run Error:", err);
      setError(err.message || "An unexpected error occurred during AI diagnostics.");
      addLog(`FATAL ERROR: ${err.message}`, 'error');
      if (db) {
        const sessionRef = doc(db, 'analysis_sessions', newSessionId);
        setDoc(sessionRef, { status: 'failed' }, { merge: true });
      }
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
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold">Active Session</p>
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
          <div className="inline-flex items-center px-3 py-1 rounded-full bg-accent/10 text-accent text-xs font-bold uppercase tracking-wider">
            Bidding Performance Engine
          </div>
          <div className="space-y-2">
            <h2 className="text-3xl font-bold font-headline text-foreground tracking-tight">
              Diagnostic Bidding Agent
            </h2>
          </div>
        </section>

        {error && (
          <Alert variant="destructive" className="bg-destructive/5 border-destructive/20">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle className="font-bold">Process Update</AlertTitle>
            <AlertDescription className="space-y-3">
              <p className="text-sm opacity-90">{error}</p>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleRunAnalysis}
                className="bg-white hover:bg-destructive/10 border-destructive/30 text-destructive h-8 font-semibold"
              >
                Retry Batch
              </Button>
            </AlertDescription>
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
              <div className="space-y-4">
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
          </div>
        </section>

        <section className="space-y-6 pt-4">
          {isLoading && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-7 flex flex-col items-center justify-center py-20 space-y-4 bg-card rounded-2xl border border-border shadow-sm">
                <div className="relative">
                  <BarChart3 className="w-12 h-12 text-primary/20 animate-pulse" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-primary animate-spin" />
                  </div>
                </div>
                <div className="text-center space-y-1">
                  <p className="font-bold text-xl font-headline text-primary">Backend Batch Processing</p>
                  <p className="text-sm text-muted-foreground">AI is analyzing catalogs with internal retry logic...</p>
                </div>
              </div>
              
              <div className="lg:col-span-5">
                <Card className="bg-slate-950 border-slate-800 shadow-xl overflow-hidden">
                  <div className="bg-slate-900 px-4 py-2 border-b border-slate-800 flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Terminal className="w-4 h-4 text-emerald-400" />
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Process Logs</span>
                    </div>
                    <div className="flex space-x-1.5">
                      <div className="w-2 h-2 rounded-full bg-slate-700"></div>
                      <div className="w-2 h-2 rounded-full bg-slate-700"></div>
                      <div className="w-2 h-2 rounded-full bg-slate-700"></div>
                    </div>
                  </div>
                  <ScrollArea className="h-[300px] p-4 font-code text-[11px] leading-relaxed">
                    <div className="space-y-2">
                      {logs.map((log, i) => (
                        <div key={i} className="flex space-x-3">
                          <span className="text-slate-500 whitespace-nowrap">[{log.timestamp}]</span>
                          <span className={
                            log.type === 'success' ? 'text-emerald-400' :
                            log.type === 'error' ? 'text-rose-400' :
                            log.type === 'warning' ? 'text-amber-400' :
                            'text-slate-300'
                          }>
                            {log.type === 'success' && '✓ '}
                            {log.type === 'error' && '✖ '}
                            {log.type === 'warning' && '! '}
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

          {!isLoading && results.length === 0 && !error && (
            <div className="py-20 text-center border border-dashed rounded-2xl bg-muted/20">
              <BarChart3 className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
              <p className="text-muted-foreground font-medium text-lg">
                {biddingData.length > 0 || selectedFile ? `Ready to analyze session` : 'Upload a CSV to begin analysis'}
              </p>
            </div>
          )}
        </section>
      </main>

      <Toaster />
    </div>
  );
}
