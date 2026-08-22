import { useEffect, useRef, useState } from "react";
import {
  Chart,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  Tooltip as ChartTooltip,
  type ChartConfiguration,
} from "chart.js";
import { SkipjackAccountUsage } from "../types/gpu-stats";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, LogarithmicScale, ChartTooltip);

const GPU_COLOR = "rgba(59, 130, 246, 0.82)";
const SCHMIDT_COLOR = "rgba(217, 119, 6, 0.55)"; // amber-600, muted — visually distinct "private condo" usage
const QUEUE_COLOR = "rgba(168, 85, 247, 0.82)";
const TEAM_ACCOUNT = "dkhasha1";
const TOP_N = 20;
// b200/b300 are Schmidt-lab-owned condo nodes (AllowAccounts=schmidt), not part
// of the general shared cluster — excluded from this chart by default.
const SCHMIDT_PARTITIONS = ["b200", "b300"];

interface SkipjackAccountUsageChartProps {
  data: SkipjackAccountUsage[];
}

interface Row extends SkipjackAccountUsage {
  shared: number;
  schmidt: number;
}

function withSplit(data: SkipjackAccountUsage[]): Row[] {
  return data.map((d) => {
    const schmidt = SCHMIDT_PARTITIONS.reduce((sum, p) => sum + (d.gpus[p] ?? 0), 0);
    return { ...d, schmidt, shared: d.total - schmidt };
  });
}

function selectRows(
  data: SkipjackAccountUsage[],
  showSchmidt: boolean
): { rows: Row[]; pinned: boolean; visibleCount: number } {
  const split = withSplit(data);
  // Only exclude accounts that are exclusively schmidt-condo users (some
  // b200/b300 usage, zero shared-cluster usage) — not accounts that just
  // happen to have zero usage everywhere, which aren't schmidt-related at all.
  const visible = showSchmidt ? split : split.filter((d) => !(d.schmidt > 0 && d.shared === 0));
  const rank = (d: Row) => (showSchmidt ? d.shared + d.schmidt : d.shared);
  const sorted = [...visible].sort((a, b) => rank(b) - rank(a) || b.queue - a.queue);
  const top = sorted.slice(0, TOP_N);
  if (top.some((d) => d.account === TEAM_ACCOUNT)) {
    return { rows: top, pinned: false, visibleCount: visible.length };
  }
  const team = sorted.find((d) => d.account === TEAM_ACCOUNT);
  return team
    ? { rows: [...top, team], pinned: true, visibleCount: visible.length }
    : { rows: top, pinned: false, visibleCount: visible.length };
}

export function SkipjackAccountUsageChart({ data }: SkipjackAccountUsageChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const [logScale, setLogScale] = useState(false);
  const [showSchmidt, setShowSchmidt] = useState(false);
  const { rows, pinned, visibleCount } = selectRows(data, showSchmidt);

  useEffect(() => {
    if (!canvasRef.current || rows.length === 0) return;

    chartRef.current?.destroy();

    const labels = rows.map((d) => d.account);
    const shared = rows.map((d) => d.shared);
    const schmidt = rows.map((d) => d.schmidt);
    const queue = rows.map((d) => d.queue);

    const config: ChartConfiguration<"bar"> = {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Running GPUs",
            data: shared,
            backgroundColor: GPU_COLOR,
            borderRadius: 2,
            barThickness: 10,
            stack: "usage",
          },
          // Stacked onto the same "usage" bar (rather than added as a separate
          // grouped bar) so toggling schmidt on/off doesn't reflow the whole
          // chart — it only extends/shrinks the existing bar's length.
          ...(showSchmidt
            ? [
                {
                  label: "B200/B300 (schmidt condo)",
                  data: schmidt,
                  backgroundColor: SCHMIDT_COLOR,
                  borderColor: "rgba(180, 83, 9, 0.9)",
                  borderWidth: 1,
                  borderRadius: 2,
                  barThickness: 10,
                  stack: "usage",
                },
              ]
            : []),
          {
            label: "Queue size (jobs)",
            data: queue,
            backgroundColor: QUEUE_COLOR,
            borderRadius: 2,
            barThickness: 10,
            stack: "queue",
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.x}`,
            },
          },
        },
        scales: {
          x: {
            type: logScale ? "logarithmic" : "linear",
            stacked: true,
            // Logarithmic scale can't represent 0; clamp the floor to 1 so
            // zero-valued bars (e.g. an account with only a queue, no running
            // GPUs) still render at the axis minimum instead of breaking it.
            min: logScale ? 1 : 0,
            position: "top",
            title: { display: true, text: logScale ? "Count (log scale)" : "Count", font: { size: 11 } },
            grid: { color: "rgba(128,128,128,0.15)" },
            ticks: { font: { size: 10 } },
          },
          y: {
            stacked: true,
            grid: { display: false },
            ticks: { font: { size: 10 } },
          },
        },
      },
    };

    chartRef.current = new Chart(canvasRef.current, config);

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [rows, logScale, showSchmidt]);

  const containerHeight = rows.length * 26 + 55;

  return (
    <div>
      {/* Custom legend + toggles */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, marginBottom: 8, fontSize: 11, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                backgroundColor: GPU_COLOR,
                flexShrink: 0,
              }}
            />
            Running GPUs
          </div>
          {showSchmidt && (
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  backgroundColor: SCHMIDT_COLOR,
                  border: "1px solid rgba(180, 83, 9, 0.9)",
                  boxSizing: "border-box",
                  flexShrink: 0,
                }}
              />
              B200/B300 (schmidt condo)
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                backgroundColor: QUEUE_COLOR,
                flexShrink: 0,
              }}
            />
            Queue size (jobs)
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="skipjack-schmidt" className="text-xs text-muted-foreground">
              Show B200/B300 (schmidt)
            </Label>
            <Switch id="skipjack-schmidt" checked={showSchmidt} onCheckedChange={setShowSchmidt} />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="skipjack-log-scale" className="text-xs text-muted-foreground">
              Log scale
            </Label>
            <Switch id="skipjack-log-scale" checked={logScale} onCheckedChange={setLogScale} />
          </div>
        </div>
      </div>
      {!showSchmidt && (
        <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 6 }}>
          B200/B300 (schmidt condo) usage hidden — toggle above to include it.
        </p>
      )}
      {visibleCount > TOP_N && (
        <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 6 }}>
          Showing top {TOP_N} of {visibleCount} accounts by usage
          {pinned ? " (your account pinned in below)" : ""}.
        </p>
      )}
      <div style={{ height: containerHeight }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
