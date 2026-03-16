"use client";

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useFirestore, useDoc, useCollection } from '@/firebase';
import { doc, collection } from 'firebase/firestore';
import { Brain, ArrowLeft, Loader2, Calendar, FileText, Clock, AlertCircle, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ResultsView } from '@/components/bid-brain/results-view';
import { ExecutionLogs } from '@/components/bid-brain/execution-logs';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { Toaster } from '@/components/ui/toaster';
import { fetchCsvFromUrl } from '@/ai/flows/diagnose-bidding-performance';

export default function SessionDetailPage() {
  const { sessionId } = useParams();
  const db = useFirestore();
  const router = useRouter();
  
  const [originalData, setOriginalData] = useState<any[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(false);

  const sessionRef = React.useMemo(() => (db && sessionId ? doc(db, 'analysis_sessions', sessionId as string) : null), [db, sessionId]);
  const resultsRef = React.useMemo(() => (db && sessionId ? collection(db, 'analysis_sessions', sessionId as string, 'results') : null), [db, sessionId]);

  const { data: session, loading: sessionLoading } = useDoc(sessionRef);
  const { data: results, loading: resultsLoading } = useCollection(resultsRef);

  useEffect(() => {
    if (session?.fileUrl) {
      setIsDataLoading(true);
      fetchCsvFromUrl(session.fileUrl)
        .then(parsed => {
          setOriginalData(parsed);
        })
        .catch(err => {
          console.error("Error fetching historical data:", err);
        })
        .finally(() => setIsDataLoading(false));
    }
  }, [session?.fileUrl]);

  const isLoading = sessionLoading || resultsLoading || isDataLoading;

  if (sessionLoading && !session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session && !sessionLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center space-y-4">
        <AlertCircle className="w-12 h-12 text-destructive" />
        <h2 className="text-xl font-bold">Session Not Found</h2>
        <Button variant="outline" onClick={() => router.push('/history')}>Back to History</Button>
      </div>
    );
  }

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
          <Button variant="outline" size="sm" asChild>
            <Link href="/history">
              <ArrowLeft className="w-4 h-4 mr-2" />
              History
            </Link>
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-8 max-w-5xl">
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <h2 className="text-3xl font-bold font-headline text-foreground tracking-tight">
                  {session?.fileName}
                </h2>
                <Badge variant={session?.status === 'completed' ? 'default' : session?.status === 'failed' ? 'destructive' : 'outline'} className="capitalize">
                  {session?.status}
                </Badge>
              </div>
              <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                <span className="flex items-center">
                  <Calendar className="w-4 h-4 mr-1.5" />
                  {session?.createdAt?.seconds 
                    ? format(new Date(session.createdAt.seconds * 1000), 'MMMM d, yyyy • HH:mm')
                    : 'Date unavailable'}
                </span>
                <span className="flex items-center">
                  <Clock className="w-4 h-4 mr-1.5" />
                  Type: {session?.analysisType}
                </span>
                <span className="flex items-center">
                  <FileText className="w-4 h-4 mr-1.5" />
                  ID: {session?.id?.slice(0, 8)}...
                </span>
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-4 bg-muted/30 rounded-xl border border-dashed text-xs text-muted-foreground">
            <div className="space-y-1">
              <span className="font-bold uppercase opacity-60">P_UP / P_DOWN</span>
              <p className="text-foreground font-medium">{session?.pUp} / {session?.pDown}</p>
            </div>
            <div className="space-y-1">
              <span className="font-bold uppercase opacity-60">ROI WINDOW (N)</span>
              <p className="text-foreground font-medium">{session?.nWindow} clicks</p>
            </div>
            <div className="space-y-1">
              <span className="font-bold uppercase opacity-60">UPDATE TRIGGER (K)</span>
              <p className="text-foreground font-medium">{session?.kTrigger} clicks</p>
            </div>
            <div className="space-y-1">
              <span className="font-bold uppercase opacity-60">CATALOGS ANALYZED</span>
              <p className="text-foreground font-medium">{results?.length || 0}</p>
            </div>
          </div>
        </section>

        <section className="space-y-12">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-4 bg-card rounded-2xl border border-border shadow-sm">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <div className="text-center">
                <p className="font-bold text-lg">Loading Historical Session</p>
                <p className="text-sm text-muted-foreground">Retrieving results and source data...</p>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                <h3 className="text-xl font-bold font-headline flex items-center">
                  <FileText className="w-5 h-5 mr-2 text-primary" />
                  Diagnostic Results
                </h3>
                <ResultsView 
                  results={results as any} 
                  analysisType={session?.analysisType} 
                  originalData={originalData}
                />
              </div>

              {session?.logs && session.logs.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center space-x-2 text-xl font-bold font-headline">
                    <Terminal className="w-5 h-5 text-primary" />
                    <h3>Diagnostic Logs</h3>
                  </div>
                  <ExecutionLogs 
                    logs={session.logs} 
                    maxHeight="400px" 
                    className="shadow-md"
                  />
                </div>
              )}
            </>
          )}
        </section>
      </main>

      <Toaster />
    </div>
  );
}
