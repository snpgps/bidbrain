"use client";

import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { DiagnoseBiddingOutput } from '@/ai/flows/diagnose-bidding-performance.schema';
import { CheckCircle2, AlertTriangle, Info, Download, ShieldAlert, BarChart3, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { exportResultsToCsv } from '@/lib/csv-utils';
import { CatalogPerformanceChart } from './catalog-performance-chart';

interface ResultsViewProps {
  results: DiagnoseBiddingOutput[];
  analysisType: string;
  originalData: any[];
}

export function ResultsView({ results, analysisType, originalData }: ResultsViewProps) {
  if (results.length === 0) return null;

  const getSeverityColor = (severity: string) => {
    switch (severity.toLowerCase()) {
      case 'high': return 'destructive';
      case 'medium': return 'secondary';
      case 'low': return 'default';
      default: return 'outline';
    }
  };

  const getCatalogData = (catalogId: string) => {
    return originalData.filter(d => d.catalog_id === catalogId).sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold font-headline">Diagnostic Results</h2>
        <Button variant="outline" size="sm" onClick={() => exportResultsToCsv(results, analysisType)}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <div className="border rounded-xl bg-card overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[180px]">Catalog ID</TableHead>
              <TableHead>Issue Status</TableHead>
              <TableHead>Root Cause</TableHead>
              <TableHead>Severity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.map((result) => (
              <React.Fragment key={result.catalog_id}>
                <TableRow className="group">
                  <TableCell className="font-mono text-sm">{result.catalog_id}</TableCell>
                  <TableCell>
                    {result.issue_confirmed ? (
                      <div className="flex items-center text-amber-600 font-medium text-sm">
                        <AlertTriangle className="w-4 h-4 mr-1.5" />
                        Confirmed
                      </div>
                    ) : (
                      <div className="flex items-center text-emerald-600 font-medium text-sm">
                        <CheckCircle2 className="w-4 h-4 mr-1.5" />
                        No Issue
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-sm font-medium">{result.root_cause}</TableCell>
                  <TableCell>
                    <Badge variant={getSeverityColor(result.severity) as any}>
                      {result.severity}
                    </Badge>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={4} className="p-0 border-t-0">
                    <Accordion type="single" collapsible className="w-full">
                      <AccordionItem value="details" className="border-b-0">
                        <AccordionTrigger className="px-4 py-2 hover:bg-muted/30 hover:no-underline text-xs text-muted-foreground font-normal">
                          View Detailed Analysis & Performance Graph
                        </AccordionTrigger>
                        <AccordionContent className="px-6 py-4 bg-muted/20 border-t">
                          <div className="space-y-8">
                            <div className="space-y-2">
                              <div className="flex items-center text-sm font-semibold text-foreground">
                                <BarChart3 className="w-4 h-4 mr-2 text-primary" />
                                Performance Trends
                              </div>
                              <div className="bg-background p-4 rounded-xl border shadow-sm">
                                <CatalogPerformanceChart data={getCatalogData(result.catalog_id)} />
                              </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                              <div className="space-y-6">
                                <div className="space-y-2">
                                  <div className="flex items-center text-sm font-semibold text-primary">
                                    <Info className="w-4 h-4 mr-2" />
                                    Diagnostic Evidence
                                  </div>
                                  <p className="text-sm leading-relaxed text-muted-foreground bg-background p-4 rounded-lg border">
                                    {result.evidence}
                                  </p>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                  <div className="space-y-2">
                                    <div className="flex items-center text-sm font-semibold text-accent">
                                      <Search className="w-4 h-4 mr-2" />
                                      L2 Reason
                                    </div>
                                    <p className="text-sm leading-relaxed text-foreground bg-background p-3 rounded-lg border border-accent/20">
                                      {result.l2_reason}
                                    </p>
                                  </div>

                                  <div className="space-y-2">
                                    <div className="flex items-center text-sm font-semibold text-destructive">
                                      <ShieldAlert className="w-4 h-4 mr-2" />
                                      Severity Justification
                                    </div>
                                    <p className="text-sm italic leading-relaxed text-muted-foreground bg-background p-3 rounded-lg border">
                                      {result.severity_justification}
                                    </p>
                                  </div>
                                </div>
                              </div>
                              
                              <div className="space-y-3">
                                <div className="flex items-center text-sm font-semibold text-emerald-600">
                                  <CheckCircle2 className="w-4 h-4 mr-2" />
                                  Actionable Recommendation
                                </div>
                                <div className="bg-background p-4 rounded-lg border border-emerald-200 shadow-sm">
                                  <p className="text-sm leading-relaxed text-foreground font-medium">
                                    {result.recommendation}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </TableCell>
                </TableRow>
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
