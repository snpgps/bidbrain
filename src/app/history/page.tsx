"use client";

import React, { useState } from 'react';
import Link from 'next/link';
import { useFirestore } from '@/firebase';
import { useCollection } from '@/firebase';
import { collection, query, orderBy, doc, deleteDoc } from 'firebase/firestore';
import { Brain, History, ArrowLeft, Calendar, FileText, CheckCircle2, Clock, AlertCircle, ChevronRight, User as UserIcon, LogIn, LogOut, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { useUser, useAuth } from '@/firebase';
import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';

export default function HistoryPage() {
  const db = useFirestore();
  const auth = useAuth();
  const { user } = useUser();
  const { toast } = useToast();
  
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);

  const sessionsQuery = React.useMemo(() => {
    if (!db) return null;
    return query(collection(db, 'analysis_sessions'), orderBy('createdAt', 'desc'));
  }, [db]);

  const { data: sessions, loading } = useCollection(sessionsQuery);

  const handleSignIn = async () => {
    if (!auth) return;
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const handleSignOut = async () => {
    if (!auth) return;
    await signOut(auth);
  };

  const handleDeleteSession = async () => {
    if (!db || !deleteSessionId) return;
    try {
      await deleteDoc(doc(db, 'analysis_sessions', deleteSessionId));
      toast({
        title: "Session Deleted",
        description: "The analysis session has been removed.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Delete Failed",
        description: error.message,
      });
    } finally {
      setDeleteSessionId(null);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case 'processing': return <Clock className="w-4 h-4 text-amber-500 animate-pulse" />;
      case 'failed': return <AlertCircle className="w-4 h-4 text-destructive" />;
      default: return <Clock className="w-4 h-4 text-muted-foreground" />;
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

      <main className="container mx-auto px-4 py-8 max-w-4xl space-y-8">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h2 className="text-2xl font-bold font-headline flex items-center">
              <History className="w-6 h-6 mr-2 text-primary" />
              Analysis History
            </h2>
            <p className="text-sm text-muted-foreground">View and revisit past diagnostic sessions.</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Link>
          </Button>
        </div>

        {loading ? (
          <div className="grid gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse h-24 bg-muted/20 border-border" />
            ))}
          </div>
        ) : sessions.length > 0 ? (
          <div className="grid gap-4">
            {sessions.map((session: any) => (
              <div key={session.id} className="relative group">
                <Link href={`/history/${session.id}`}>
                  <Card className="hover:border-primary/50 transition-all overflow-hidden border-border bg-card shadow-sm hover:shadow-md pr-12">
                    <CardContent className="p-0">
                      <div className="flex items-center p-5">
                        <div className="flex-1 space-y-1.5">
                          <div className="flex items-center space-x-3 flex-wrap gap-y-2">
                            <h3 className="font-bold text-foreground group-hover:text-primary transition-colors">
                              {session.fileName}
                            </h3>
                            <Badge variant="outline" className="text-[10px] uppercase font-bold">
                              {session.analysisType}
                            </Badge>
                            <div className="flex items-center space-x-1.5 text-xs text-muted-foreground">
                              {getStatusIcon(session.status)}
                              <span className="capitalize">{session.status}</span>
                            </div>
                          </div>
                          <div className="flex items-center space-x-4 text-xs text-muted-foreground">
                            <span className="flex items-center">
                              <Calendar className="w-3 h-3 mr-1" />
                              {session.createdAt?.seconds 
                                ? format(new Date(session.createdAt.seconds * 1000), 'MMM d, yyyy • HH:mm')
                                : 'Pending...'}
                            </span>
                            <span className="flex items-center">
                              <FileText className="w-3 h-3 mr-1" />
                              ID: {session.id.slice(0, 8)}...
                            </span>
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDeleteSessionId(session.id);
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-20 text-center border border-dashed rounded-2xl bg-muted/20">
            <History className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-muted-foreground font-medium text-lg">No analysis history found.</p>
            <Button variant="link" asChild className="mt-2">
              <Link href="/">Run your first analysis</Link>
            </Button>
          </div>
        )}
      </main>

      <AlertDialog open={!!deleteSessionId} onOpenChange={(open) => !open && setDeleteSessionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this analysis session and all associated results. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteSession} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete Session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
