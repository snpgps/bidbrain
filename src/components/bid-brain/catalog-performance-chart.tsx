"use client";

import React from 'react';
import {
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
} from 'recharts';
import { ChartContainer } from '@/components/ui/chart';

interface CatalogPerformanceChartProps {
  data: any[];
}

const chartConfig = {
  catalog_roi: { label: 'Catalog ROI', color: '#a78bfa' },
  roi_target: { label: 'ROI Target', color: '#fb923c' },
  bu_ideal: { label: 'BU Ideal', color: '#6366f1' },
  catalog_bu_perc: { label: 'Catalog BU %', color: '#facc15' },
  sl_roi: { label: 'SL ROI', color: '#f87171' },
  catalog_clicks: { label: 'Clicks', color: '#4ade80' },
  day_roi: { label: 'Day ROI', color: '#60a5fa' },
  catalog_gmv: { label: 'GMV', color: '#99f6e4' },
};

export function CatalogPerformanceChart({ data }: CatalogPerformanceChartProps) {
  // Format dates for display
  const formattedData = data.map((d) => ({
    ...d,
    formattedTs: new Date(d.timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
    }),
    fullTimestamp: d.timestamp, 
  }));

  return (
    <div className="h-[450px] w-full mt-4">
      <ChartContainer config={chartConfig}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={formattedData} margin={{ top: 10, right: 30, left: 0, bottom: 40 }}>
            <defs>
              <linearGradient id="colorGmv" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#99f6e4" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#99f6e4" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
            <XAxis
              dataKey="formattedTs"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              minTickGap={30}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              domain={[0, 'auto']}
              label={{ value: 'ROI / BU %', angle: -90, position: 'insideLeft', offset: 10, fontSize: 10 }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              domain={[0, 'auto']}
              label={{ value: 'GMV / Clicks', angle: 90, position: 'insideRight', offset: 10, fontSize: 10 }}
            />
            <Tooltip 
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const dataPoint = payload[0].payload;
                  return (
                    <div className="bg-background border border-border p-3 rounded-lg shadow-xl text-xs space-y-2 min-w-[220px]">
                      <p className="font-bold border-b pb-1 text-primary">Update: {dataPoint.fullTimestamp}</p>
                      
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 py-1">
                        <div className="flex flex-col">
                          <span className="text-[10px] uppercase text-muted-foreground font-bold">Catalog Status</span>
                          <span className="font-medium text-foreground">{dataPoint.catalog_status || 'N/A'}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] uppercase text-muted-foreground font-bold">Campaign Status</span>
                          <span className="font-medium text-foreground">{dataPoint.campaign_status || 'N/A'}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 py-1 border-y border-border/50">
                        <div className="flex flex-col">
                          <span className="text-[10px] uppercase text-muted-foreground font-bold">Budget</span>
                          <span className="font-mono text-foreground">{(dataPoint.budget || 0).toLocaleString()}</span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[10px] uppercase text-muted-foreground font-bold">Spend (Utilised)</span>
                          <span className="font-mono text-foreground">{(dataPoint.spend || 0).toLocaleString()}</span>
                        </div>
                      </div>

                      <div className="space-y-1">
                        {payload.map((entry: any, index: number) => (
                          <div key={index} className="flex items-center justify-between space-x-4">
                            <span style={{ color: entry.color }} className="font-medium">{entry.name}:</span>
                            <span className="font-mono">{entry.value.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }
                return null;
              }} 
            />
            <Legend 
              wrapperStyle={{ fontSize: '10px', paddingTop: '20px' }} 
              verticalAlign="bottom"
              align="center"
            />
            
            <Bar
              yAxisId="right"
              dataKey="catalog_clicks"
              fill="var(--color-catalog_clicks)"
              name="Clicks"
              radius={[2, 2, 0, 0]}
              opacity={0.6}
            />
            <Area
              yAxisId="right"
              type="monotone"
              dataKey="catalog_gmv"
              name="GMV"
              stroke="#99f6e4"
              fillOpacity={1}
              fill="url(#colorGmv)"
              strokeWidth={1}
            />
            
            <Line
              yAxisId="left"
              type="stepAfter"
              dataKey="roi_target"
              name="ROI Target"
              stroke="#fb923c"
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="left"
              type="stepAfter"
              dataKey="sl_roi"
              name="SL ROI"
              stroke="#f87171"
              strokeWidth={3}
              dot={false}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="catalog_roi"
              name="Catalog ROI"
              stroke="#a78bfa"
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="catalog_bu_perc"
              name="Catalog BU %"
              stroke="#facc15"
              strokeWidth={1.5}
              dot={false}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="bu_ideal"
              name="BU Ideal"
              stroke="#6366f1"
              strokeWidth={1.5}
              strokeDasharray="5 5"
              dot={false}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="day_roi"
              name="Day ROI"
              stroke="#60a5fa"
              strokeWidth={1}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  );
}
