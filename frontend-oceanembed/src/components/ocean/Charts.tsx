import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DepthLevel } from "@/lib/ocean-model";

const axis = {
  stroke: "var(--muted-foreground)",
  fontSize: 11,
};

const tooltipStyle = {
  contentStyle: {
    background: "var(--popover)",
    border: "1px solid var(--border)",
    borderRadius: "0.5rem",
    fontSize: "0.75rem",
    color: "var(--popover-foreground)",
  },
  labelStyle: { color: "var(--muted-foreground)" },
};

export function VerticalProfileChart({
  levels,
  predLabel = "Predicted (OceanEmbed)",
  refLabel = "Reference (Gridded ARGO)",
}: {
  levels: DepthLevel[];
  predLabel?: string;
  refLabel?: string;
}) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={levels}
          layout="vertical"
          margin={{ top: 8, right: 12, bottom: 18, left: 4 }}
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            type="number"
            domain={[0, 32]}
            tick={axis}
            tickLine={false}
            label={{
              value: "Temperature (°C)",
              position: "insideBottom",
              offset: -10,
              fill: "var(--muted-foreground)",
              fontSize: 11,
            }}
          />
          <YAxis
            dataKey="depth"
            type="number"
            domain={[0, 1000]}
            tick={axis}
            tickLine={false}
            width={44}
            label={{
              value: "Depth (m)",
              angle: -90,
              position: "insideLeft",
              fill: "var(--muted-foreground)",
              fontSize: 11,
            }}
          />
          <Tooltip {...tooltipStyle} />
          <Line
            dataKey="temperature"
            name={predLabel}
            stroke="var(--color-chart-2)"
            strokeWidth={2.4}
            isAnimationActive={false}
            dot={{ r: 2.5, fill: "var(--color-chart-2)" }}
          />
          <Line
            dataKey="reference"
            name={refLabel}
            stroke="var(--color-foreground)"
            strokeWidth={1.6}
            isAnimationActive={false}
            strokeDasharray="5 4"
            dot={{ r: 2, fill: "var(--color-foreground)" }}
          />
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-6 rounded bg-chart-2" /> {predLabel}
        </span>
        <span className="flex items-center gap-2">
          <span className="h-0.5 w-6 rounded border-t border-dashed border-foreground" /> {refLabel}
        </span>
      </div>
    </div>
  );
}

export function TimeSeriesChart({
  data,
}: {
  data: { day: string; temperature: number }[];
}) {
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="day" tick={axis} tickLine={false} interval={4} />
          <YAxis
            tick={axis}
            tickLine={false}
            width={40}
            domain={["dataMin - 1", "dataMax + 1"]}
            tickFormatter={(v) => Number(v).toFixed(1)}
          />
          <Tooltip {...tooltipStyle} formatter={(v) => [`${v} °C`, "Temperature"]} />
          <Line
            dataKey="temperature"
            stroke="var(--color-chart-1)"
            strokeWidth={2.2}
            isAnimationActive={false}
            dot={{ r: 2.5, fill: "var(--color-chart-1)" }}
            activeDot={{ r: 5, fill: "var(--color-foreground)" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
