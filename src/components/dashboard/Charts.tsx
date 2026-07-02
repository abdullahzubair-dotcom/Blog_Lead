"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell, Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
];

interface CompetitorHeatmapProps {
  data: { tool: string; count: number }[];
}
export function CompetitorHeatmap({ data }: CompetitorHeatmapProps) {
  if (!data?.length) return <EmptyChart title="Tool Mention Frequency" description="How often each tool appears in your prospect pool" />;
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Tool Mention Frequency</CardTitle>
        <CardDescription>Top gen-AI tools mentioned by your prospects</CardDescription>
      </CardHeader>
      <CardContent className="pl-2">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data.slice(0, 12)} margin={{ top: 5, right: 10, left: -20, bottom: 44 }}>
            <XAxis dataKey="tool" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" interval={0} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ borderRadius: 8, fontSize: 12 }}
              formatter={(v) => [`${v} mentions`, "Count"]}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {data.slice(0, 12).map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

interface FreshnessTimelineProps {
  data: { date: string; count: number }[];
}
export function FreshnessTimeline({ data }: FreshnessTimelineProps) {
  if (!data?.length) return <EmptyChart title="Article Freshness" description="Articles discovered over time" />;
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Article Freshness</CardTitle>
        <CardDescription>Articles discovered / published (last 90 days)</CardDescription>
      </CardHeader>
      <CardContent className="pl-2">
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              tickFormatter={(d) => d.slice(5)}
              interval={Math.max(0, Math.floor(data.length / 6) - 1)}
            />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ borderRadius: 8, fontSize: 12 }}
              formatter={(v) => [`${v} articles`, ""]}
            />
            <Area type="monotone" dataKey="count" stroke="#8b5cf6" strokeWidth={2} fill="url(#areaGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

interface ProvenanceChartProps {
  data: { source: string; count: number }[];
}
export function ProvenanceChart({ data }: ProvenanceChartProps) {
  if (!data?.length) return <EmptyChart title="Source Provenance" description="Which harvester found the most prospects" />;
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Source Provenance</CardTitle>
        <CardDescription>Which harvester contributed the most</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={240}>
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="source"
              cx="50%"
              cy="45%"
              outerRadius={80}
              innerRadius={45}
              paddingAngle={2}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ borderRadius: 8, fontSize: 12 }}
              formatter={(v, name) => [`${v} hits`, name]}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
              formatter={(v) => v}
            />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

interface TopPublicationsProps {
  data: { name: string; host: string; count: number; avgScore: number }[];
}
export function TopPublications({ data }: TopPublicationsProps) {
  if (!data?.length) return <EmptyChart title="Top Publications" description="Publications with the most prospects" />;
  const max = data[0]?.count ?? 1;
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">Top Publications</CardTitle>
        <CardDescription>Publications with the most scored authors</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {data.slice(0, 8).map((pub, i) => (
            <div key={pub.host} className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground w-4 shrink-0">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-sm font-medium truncate">{pub.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">{pub.count}</span>
                    <span className="text-xs font-mono text-violet-500 dark:text-violet-400">{pub.avgScore}</span>
                  </div>
                </div>
                <div className="h-1.5 bg-secondary rounded-full">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.min(100, (pub.count / max) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyChart({ title, description }: { title: string; description: string }) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-center min-h-[200px]">
        <div className="text-center">
          <p className="text-muted-foreground text-sm">No data yet</p>
          <p className="text-muted-foreground/60 text-xs mt-1">Run discovery to populate</p>
        </div>
      </CardContent>
    </Card>
  );
}
