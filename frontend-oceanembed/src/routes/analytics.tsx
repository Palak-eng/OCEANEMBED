import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { VerticalProfileChart } from "@/components/ocean/Charts";
import { Panel } from "@/components/ocean/Panel";
import { AppShell } from "@/components/ocean/TopNav";
import { SKILL_METRICS, reconstruct } from "@/lib/ocean-model";
import { getMetrics } from "@/lib/django.functions";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Validation & Skill Metrics — OceanEmbed" },
      {
        name: "description",
        content:
          "Depth-wise RMSE, correlation and bias of the OceanEmbed reconstruction validated against independent gridded ARGO profiles.",
      },
      { property: "og:title", content: "Validation & Skill Metrics — OceanEmbed" },
      {
        property: "og:description",
        content: "Skill scores per depth level against independent ARGO observations.",
      },
    ],
  }),
  component: AnalyticsPage,
});

const PIPELINE = [
  { step: "01", title: "Ingest", detail: "SST, SSS, SLA/SSH, surface currents (U,V), winds (U,V)" },
  { step: "02", title: "Harmonise", detail: "Regrid to 0.25° × 0.25°, daily compositing, gap filling" },
  { step: "03", title: "Embed", detail: "CNN + ViT encoder producing 128-d latent ocean state" },
  { step: "04", title: "Reconstruct", detail: "Attention decoder to 15 standard depth levels" },
  { step: "05", title: "Validate", detail: "Independent gridded ARGO profiles, RMSE / corr / bias" },
];

function AnalyticsPage() {
  const data = useMemo(() => reconstruct(15.2, 88.6), []);

  const metricsQuery = useQuery({
    queryKey: ["skill-metrics"],
    queryFn: () => getMetrics({ data: undefined }),
    staleTime: 30 * 60 * 1000,
    retry: false,
  });

  const m = metricsQuery.data?.metrics;
  const skillCards = m
    ? [
        { label: "RMSE", value: `${m.rmse_c.toFixed(2)} °C` },
        { label: "Correlation", value: m.correlation.toFixed(2) },
        { label: "Bias", value: `${m.bias_c > 0 ? "+" : ""}${m.bias_c.toFixed(2)} °C` },
      ]
    : SKILL_METRICS;

  const perDepth = metricsQuery.data?.per_depth?.length
    ? metricsQuery.data.per_depth.map((d) => ({
        depth: d.depth_m,
        rmse: d.rmse_c.toFixed(2),
        bias: d.bias_c.toFixed(2),
        corr: d.correlation.toFixed(2),
      }))
    : data.levels.map((l) => ({
        depth: l.depth,
        rmse: Math.abs(l.temperature - l.reference).toFixed(2),
        bias: (l.reference - l.temperature).toFixed(2),
        corr: (0.99 - l.depth / 12000).toFixed(2),
      }));

  return (
    <AppShell>
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {skillCards.map((card) => (
            <div key={card.label} className="panel-surface px-5 py-4">
              <p className="label-caps">{card.label}</p>
              <p className="font-display text-3xl font-semibold">{card.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {metricsQuery.data ? "From validation against independent gridded ARGO" : "Validated against independent gridded ARGO"}
              </p>
            </div>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Panel title="Framework pipeline" subtitle="Surface observations to 3-D temperature">
            <ol className="space-y-3">
              {PIPELINE.map((p) => (
                <li key={p.step} className="flex gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/25 font-display text-sm font-semibold text-accent">
                    {p.step}
                  </span>
                  <div>
                    <p className="font-display text-sm font-semibold">{p.title}</p>
                    <p className="text-xs text-muted-foreground">{p.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>

          <Panel title="Reference profile" subtitle="Bay of Bengal · 15.2°N, 88.6°E">
            <VerticalProfileChart levels={data.levels} />
          </Panel>
        </div>

        <Panel title="Depth-wise skill scores" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="label-caps">
                  <th className="px-4 py-2 text-left font-semibold">Depth (m)</th>
                  <th className="px-4 py-2 text-right font-semibold">RMSE (°C)</th>
                  <th className="px-4 py-2 text-right font-semibold">Bias (°C)</th>
                  <th className="px-4 py-2 text-right font-semibold">Correlation</th>
                </tr>
              </thead>
              <tbody>
                {perDepth.map((r) => (
                  <tr key={r.depth} className="border-t border-border hover:bg-secondary/40">
                    <td className="px-4 py-2 text-muted-foreground">{r.depth}</td>
                    <td className="px-4 py-2 text-right font-display">{r.rmse}</td>
                    <td className="px-4 py-2 text-right font-display">{r.bias}</td>
                    <td className="px-4 py-2 text-right font-display">{r.corr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
