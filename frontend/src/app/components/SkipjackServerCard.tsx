import { SkipjackStats } from "../types/gpu-stats";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Server, AlertCircle, Info, Cpu, Boxes } from "lucide-react";

interface SkipjackServerCardProps {
  stats: SkipjackStats | null;
  error?: string | null;
}

export function SkipjackServerCard({ stats, error }: SkipjackServerCardProps) {
  if (!stats) {
    return (
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              <CardTitle>Skipjack (ARCH)</CardTitle>
            </div>
            <Badge variant="default">API</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-red-500 text-sm">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span className="break-all font-mono">{error ?? "Data unavailable"}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const t = stats.team_summary;
  const maxGpuH = Math.max(1, ...stats.members.map((m) => m.gpu_hours));
  const activeMembers = stats.members.filter((m) => m.jobs > 0);

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            <CardTitle>Skipjack Cluster</CardTitle>
          </div>
          <Badge variant="default">
            ARCH API · {stats.gpu_partitions.length} GPU partitions
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Data-kind disclaimer — this is accounting, not live telemetry */}
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
          <div className="flex items-start gap-2 text-xs text-blue-900 dark:text-blue-200">
            <Info className="h-4 w-4 flex-shrink-0 mt-0.5" />
            <span>
              Accounting data from the ARCH portal — historical job & GPU-hours.
              The API exposes no live GPU occupancy or memory telemetry (no SSH
              access to Skipjack).
            </span>
          </div>
        </div>

        {/* Team totals */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Jobs</div>
            <div className="text-2xl font-bold">{t.jobs.toLocaleString()}</div>
          </div>
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">GPU-hours</div>
            <div className="text-2xl font-bold text-purple-600">
              {t.gpu_hours.toFixed(1)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">CPU-hours</div>
            <div className="text-2xl font-bold text-teal-600">
              {t.cpu_hours.toFixed(1)}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">Node-hours</div>
            <div className="text-2xl font-bold">{t.node_hours.toFixed(1)}</div>
          </div>
        </div>

        {/* GPU partitions */}
        <div className="space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Boxes className="h-4 w-4" /> GPU Partitions
          </h4>
          <div className="flex flex-wrap gap-2">
            {stats.partitions.map((p) => (
              <Badge
                key={p.name}
                variant={p.is_gpu ? "secondary" : "outline"}
                className={p.is_gpu ? "" : "text-muted-foreground"}
                title={`state: ${p.state} · max ${p.max_time}${p.is_default ? " · default" : ""}`}
              >
                {p.name}
                {p.is_gpu && <Cpu className="h-3 w-3 ml-1" />}
              </Badge>
            ))}
          </div>
        </div>

        {/* Per-member usage — "who's using the most" */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">
              Team Usage — {stats.project.title ?? "Project"}
            </h4>
            <span className="text-xs text-muted-foreground">
              {stats.project.member_count} members · PI {stats.project.pi}
            </span>
          </div>

          {activeMembers.length === 0 ? (
            <div className="text-xs text-muted-foreground border rounded-lg p-3">
              No jobs recorded yet — every member is at 0 GPU-hours. This table
              populates automatically once the team runs jobs on Skipjack.
            </div>
          ) : (
            <div className="space-y-2">
              {stats.members.map((m) => {
                const pct = (m.gpu_hours / maxGpuH) * 100;
                return (
                  <div key={m.user} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono">{m.user}</span>
                      <span className="text-muted-foreground">
                        {m.gpu_hours.toFixed(1)} GPU-h · {m.jobs} jobs
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-purple-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
