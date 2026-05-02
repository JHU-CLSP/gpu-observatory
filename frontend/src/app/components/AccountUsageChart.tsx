import { useEffect, useRef } from "react";
import {
  Chart,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip as ChartTooltip,
  type ChartConfiguration,
} from "chart.js";
import { DSAIAccountUsage } from "../types/gpu-stats";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, ChartTooltip);

const GPU_COLOR = "rgba(59, 130, 246, 0.82)";
const QUEUE_COLOR = "rgba(168, 85, 247, 0.82)";

interface AccountUsageChartProps {
  data: DSAIAccountUsage[];
}

export function AccountUsageChart({ data }: AccountUsageChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current || data.length === 0) return;

    chartRef.current?.destroy();

    const labels = data.map((d) => d.account);
    const gpus = data.map((d) => d.total);
    const queue = data.map((d) => d.queue);

    const config: ChartConfiguration<"bar"> = {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Running GPUs",
            data: gpus,
            backgroundColor: GPU_COLOR,
            borderRadius: 2,
            barThickness: 10,
          },
          {
            label: "Queue size (jobs)",
            data: queue,
            backgroundColor: QUEUE_COLOR,
            borderRadius: 2,
            barThickness: 10,
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
            position: "top",
            title: { display: true, text: "Count", font: { size: 11 } },
            grid: { color: "rgba(128,128,128,0.15)" },
            ticks: { font: { size: 10 } },
          },
          y: {
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
  }, [data]);

  const containerHeight = data.length * 26 + 55;

  return (
    <div>
      {/* Custom legend */}
      <div style={{ display: "flex", gap: 14, marginBottom: 8, fontSize: 11 }}>
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
      <div style={{ height: containerHeight }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
