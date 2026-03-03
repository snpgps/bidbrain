"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { Brain, Settings2, BarChart3, Database, ShieldCheck, AlertCircle, History, Loader2, LogIn, LogOut, User as UserIcon } from 'lucide-react';
import { CsvUploader } from '@/components/bid-brain/csv-uploader';
import { AnalysisControls } from '@/components/bid-brain/analysis-controls';
import { ResultsView } from '@/components/bid-brain/results-view';
import { diagnoseBiddingPerformance } from '@/ai/flows/diagnose-bidding-performance';
import { DiagnoseBiddingOutput } from '@/ai/flows/diagnose-bidding-performance.schema';
import { Toaster } from '@/components/ui/toaster';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useFirestore, useUser, useStorage, useAuth } from '@/firebase';
import { collection, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError, type SecurityRuleContext } from '@/firebase/errors';
import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

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
  const [sessionId, setSessionId] = useState<string | null>(null);

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

    const newSessionId = crypto.randomUUID();
    setSessionId(newSessionId);

    try {
      let fileUrl = '';
      
      // 1. Upload to Storage if a file is selected
      if (selectedFile) {
        const storageRef = ref(storage, `uploads/${newSessionId}/${selectedFile.name}`);
        const uploadResult = await uploadBytes(storageRef, selectedFile);
        fileUrl = await getDownloadURL(uploadResult.ref);
      }

      // 2. Create session record in Firestore
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

      setDoc(sessionRef, sessionData)
        .catch(async (serverError) => {
          const permissionError = new FirestorePermissionError({
            path: sessionRef.path,
            operation: 'create',
            requestResourceData: sessionData,
          } satisfies SecurityRuleContext);
          errorEmitter.emit('permission-error', permissionError);
        });

      // 3. Run Analysis
      const diagnosticResults = await diagnoseBiddingPerformance({
        analysisType,
        biddingData: selectedFile ? [] : biddingData,
        fileUrl: fileUrl,
        pUp,
        pDown,
        nWindow,
        kTrigger
      });
      
      if (!diagnosticResults || diagnosticResults.length === 0) {
        throw new Error("No issues were confirmed in the uploaded data.");
      }

      // 4. Store results in Firestore subcollection
      diagnosticResults.forEach((res) => {
        const resRef = doc(db, 'analysis_sessions', newSessionId, 'results', res.catalog_id);
        const resData = {
          ...res,
          timestamp: new Date().toISOString()
        };
        
        setDoc(resRef, resData)
          .catch(async (serverError) => {
            const permissionError = new FirestorePermissionError({
              path: resRef.path,
              operation: 'create',
              requestResourceData: resData,
            } satisfies SecurityRuleContext);
            errorEmitter.emit('permission-error', permissionError);
          });
      });

      // 5. Update session status
      setDoc(sessionRef, { status: 'completed' }, { merge: true })
        .catch(async (serverError) => {
          const permissionError = new FirestorePermissionError({
            path: sessionRef.path,
            operation: 'update',
            requestResourceData: { status: 'completed' },
          } satisfies SecurityRuleContext);
          errorEmitter.emit('permission-error', permissionError);
        });

      setResults(diagnosticResults);
    } catch (err: any) {
      console.error("Diagnostic Run Error:", err);
      setError(err.message || "An unexpected error occurred during AI diagnostics.");
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
            <div className="flex flex-col items-center justify-center py-20 space-y-4 animate-in fade-in zoom-in-95 duration-300 bg-card rounded-2xl border border-border shadow-sm">
              <div className="relative">
                <BarChart3 className="w-12 h-12 text-primary/20 animate-pulse" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-primary animate-spin" />
                </div>
              </div>
              <div className="text-center space-y-1">
                <p className="font-bold text-xl font-headline text-primary">Processing Diagnostic Session</p>
                <p className="text-sm text-muted-foreground">Persisting file to Storage and results to Firestore...</p>
              </div>
            </div>
          )}

          {!isLoading && results.length > 0 && (
            <ResultsView 
              results={results} 
              analysisType={analysisType} 
              originalData={selectedFile ? biddingData : biddingData}
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
