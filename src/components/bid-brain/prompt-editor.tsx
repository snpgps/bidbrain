
"use client";

import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Settings2, Save, RotateCcw, Info } from 'lucide-react';
import { useFirestore } from '@/firebase';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';

interface PromptEditorProps {
  systemPrompt: string;
  setSystemPrompt: (val: string) => void;
  userPrompt: string;
  setUserPrompt: (val: string) => void;
  onRestoreDefaults: () => void;
  isLoading: boolean;
}

export function PromptEditor({
  systemPrompt,
  setSystemPrompt,
  userPrompt,
  setUserPrompt,
  onRestoreDefaults,
  isLoading
}: PromptEditorProps) {
  const db = useFirestore();
  const { toast } = useToast();

  const handleSaveToFirebase = async () => {
    if (!db) return;
    try {
      const promptRef = doc(db, 'prompts', 'bidding_analysis');
      await setDoc(promptRef, {
        systemPrompt,
        userPrompt,
        updatedAt: serverTimestamp(),
      });
      toast({
        title: "Prompt Saved",
        description: "Custom AI instructions updated successfully.",
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Save Failed",
        description: err.message,
      });
    }
  };

  return (
    <Card className="border-accent/20 shadow-lg overflow-hidden">
      <CardHeader className="bg-muted/30 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Settings2 className="w-5 h-5 text-primary" />
            <div>
              <CardTitle className="text-lg">AI Instruction Editor</CardTitle>
              <CardDescription>Customize the logic used by the AI to analyze your catalogs.</CardDescription>
            </div>
          </div>
          <div className="flex space-x-2">
            <Button variant="outline" size="sm" onClick={onRestoreDefaults} disabled={isLoading}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset
            </Button>
            <Button size="sm" onClick={handleSaveToFirebase} disabled={isLoading}>
              <Save className="w-4 h-4 mr-2" />
              Save to Firestore
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        <div className="space-y-2">
          <Label className="text-sm font-bold flex items-center">
            System Instructions
            <div className="ml-2 group relative">
              <Info className="w-3 h-3 text-muted-foreground" />
              <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-slate-900 text-white text-[10px] rounded shadow-xl z-50">
                Defines the AI's persona and core logic. Use Handlebars like {"{{nWindow}}"} to inject variables.
              </div>
            </div>
          </Label>
          <Textarea 
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="font-mono text-xs min-h-[250px] bg-muted/20"
            placeholder="System instructions..."
            disabled={isLoading}
          />
        </div>

        <div className="space-y-2">
          <Label className="text-sm font-bold flex items-center">
            Prompt Template
            <div className="ml-2 group relative">
              <Info className="w-3 h-3 text-muted-foreground" />
              <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-slate-900 text-white text-[10px] rounded shadow-xl z-50">
                The actual request sent to the AI per catalog.
              </div>
            </div>
          </Label>
          <Textarea 
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            className="font-mono text-xs min-h-[150px] bg-muted/20"
            placeholder="User prompt template..."
            disabled={isLoading}
          />
        </div>

        <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <p className="text-[10px] text-primary font-medium flex items-center">
            <Info className="w-3 h-3 mr-2" />
            Changes saved to Firestore will be used as the default for all future sessions.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
