
"use client";

import React, { useEffect, useRef } from 'react';
import { Terminal } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export type LogEntry = {
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
};

interface ExecutionLogsProps {
  logs: LogEntry[];
  isLoading?: boolean;
  className?: string;
  maxHeight?: string;
}

export function ExecutionLogs({ logs, isLoading, className, maxHeight = "600px" }: ExecutionLogsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  return (
    <Card className={cn("bg-slate-950 border-slate-800 shadow-xl overflow-hidden", className)}>
      <div className="bg-slate-900 px-4 py-2 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Terminal className="w-3 h-3 text-emerald-400" />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Execution Logs</span>
        </div>
        {isLoading && <span className="text-[10px] text-emerald-500 animate-pulse font-mono">RUNNING</span>}
      </div>
      <ScrollArea style={{ height: maxHeight }} className="p-4 font-code text-[11px]">
        <div className="space-y-1.5">
          {logs.map((log, i) => (
            <div key={i} className="flex space-x-3">
              <span className="text-slate-500 whitespace-nowrap">{log.timestamp}</span>
              <span className={cn(
                log.type === 'success' ? 'text-emerald-400' : 
                log.type === 'error' ? 'text-rose-400' : 
                log.type === 'warning' ? 'text-amber-400' : 
                'text-slate-300'
              )}>
                {log.message}
              </span>
            </div>
          ))}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>
    </Card>
  );
}
