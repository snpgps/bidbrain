"use client";

import React from 'react';
import {
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ComposedChart,
} from 'recharts';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';

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
  }));

  return (
    <div className="h-[400px] w-full mt-4">
      <ChartContainer config={chartConfig}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={formattedData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
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
            <ChartTooltip content={<ChartTooltipContent />} />
            <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
            
            {/* Areas and Bars on Right Axis */}
            <Area
              yAxisId="right"
              type="monotone"
              dataKey="catalog_gmv"
              stroke="#99f6e4"
              fillOpacity={1}
              fill="url(#colorGmv)"
              strokeWidth={1}
            />
            
            {/* Lines on Left Axis */}
            <Line
              yAxisId="left"
              type="stepAfter"
              dataKey="roi_target"
              stroke="#fb923c"
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="left"
              type="stepAfter"
              dataKey="sl_roi"
              stroke="#f87171"
              strokeWidth={3}
              dot={false}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="catalog_roi"
              stroke="#a78bfa"
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="catalog_bu_perc"
              stroke="#facc15"
              strokeWidth={1.5}
              dot={false}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="bu_ideal"
              stroke="#6366f1"
              strokeWidth={1.5}
              strokeDasharray="5 5"
              dot={false}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="day_roi"
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
