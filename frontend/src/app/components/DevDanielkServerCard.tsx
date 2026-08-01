import { DevDanielkStats } from "../types/gpu-stats";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Server, AlertTriangle, AlertCircle, Activity, Zap } from "lucide-react";
import { Progress } from "./ui/progress";

interface DevDanielkServerCardProps {
  stats: DevDanielkStats | null;
  error?: string | null;
}

export function DevDanielkServerCard({ stats, error }: DevDanielkServerCardProps) {
  if (!stats) {
    return (
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5" />
              <CardTitle>devdanielk (RTX 6000) Node</CardTitle>
            </div>
            <Badge variant="default">Unscheduled</Badge>
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
  const allocatedPercent = (stats.summary.allocated_gpus / stats.summary.total_gpus) * 100;
  const activePercent = (stats.summary.active_gpus / stats.summary.total_gpus) * 100;
  const memUsedPercent = (stats.summary.total_mem_used_mb / stats.summary.total_mem_mb) * 100;
  const totalPowerDraw = stats.gpus.reduce((sum, g) => sum + g.power_draw_w, 0);
  const totalPowerLimit = stats.gpus.reduce((sum, g) => sum + g.power_limit_w, 0);

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            <CardTitle>devdanielk Node</CardTitle>
          </div>
          <Badge variant="default">Unscheduled · 8× RTX PRO 6000</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* GPU Status Overview */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">Allocated GPUs</div>
            <div className="text-2xl font-bold">
              {stats.summary.allocated_gpus} / {stats.summary.total_gpus}
            </div>
            <Progress value={allocatedPercent} className="h-2" />
          </div>
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">Active GPUs</div>
            <div className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-5 w-5 text-green-500" />
              {stats.summary.active_gpus}
            </div>
            <Progress value={activePercent} className="h-2 bg-green-100" />
          </div>
        </div>

        {/* Memory Usage */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>Memory Usage</span>
            <span className="font-bold">
              {(stats.summary.total_mem_used_mb / 1024).toFixed(1)} / {(stats.summary.total_mem_mb / 1024).toFixed(0)} GB
            </span>
          </div>
          <Progress value={memUsedPercent} className="h-2" />
          <p className="text-xs text-muted-foreground">
            {memUsedPercent.toFixed(1)}% memory utilized
          </p>
        </div>

        {/* Power Draw */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Power Draw
            </span>
            <span className="font-bold">
              {totalPowerDraw.toFixed(0)} / {totalPowerLimit.toFixed(0)} W
            </span>
          </div>
          <Progress value={totalPowerLimit > 0 ? (totalPowerDraw / totalPowerLimit) * 100 : 0} className="h-2" />
        </div>

        {/* Idle Allocated GPUs Warning */}
        {stats.summary.idle_allocated > 0 && (
          <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                <div className="font-semibold text-sm">
                  {stats.summary.idle_allocated} Allocated but Idle GPU{stats.summary.idle_allocated !== 1 ? 's' : ''}
                </div>
                <div className="space-y-1">
                  {stats.idle_allocated_gpus.map((item) => (
                    <div
                      key={item.gpu}
                      className="text-xs flex items-center justify-between bg-white dark:bg-amber-900 rounded px-2 py-1"
                    >
                      <span className="font-mono">GPU {item.gpu}</span>
                      <span className="text-muted-foreground">{item.user}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* GPU Grid */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">GPU Status Grid</h4>
          <div className="grid grid-cols-4 gap-2">
            {stats.gpus.map((gpu) => {
              const isActive = gpu.util_pct > 0;
              const isIdle = stats.idle_allocated_gpus.some(idle => idle.gpu === gpu.index);
              const memPct = gpu.mem_total_mb > 0 ? (gpu.mem_used_mb / gpu.mem_total_mb) * 100 : 0;
              const memUsedGb = (gpu.mem_used_mb / 1024).toFixed(0);
              const memTotalGb = (gpu.mem_total_mb / 1024).toFixed(0);

              return (
                <div
                  key={gpu.index}
                  className={`aspect-square border-2 rounded-lg flex flex-col items-center justify-between p-1.5 overflow-hidden ${
                    isIdle
                      ? "border-amber-400 bg-amber-50 dark:bg-amber-950"
                      : isActive
                      ? "border-green-500 bg-green-50 dark:bg-green-950"
                      : "border-gray-200 bg-gray-50 dark:bg-gray-900"
                  }`}
                  title={`GPU ${gpu.index} — util: ${gpu.util_pct}% | mem: ${memUsedGb}/${memTotalGb} GB (${memPct.toFixed(0)}%) | power: ${gpu.power_draw_w.toFixed(0)}/${gpu.power_limit_w.toFixed(0)}W`}
                >
                  <div className="text-xs font-bold">GPU {gpu.index}</div>
                  <div className="text-xs text-muted-foreground">{gpu.util_pct}%</div>
                  <div className="w-full space-y-0.5">
                    <div className="w-full h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${memPct < 20 ? "bg-red-400" : memPct < 50 ? "bg-amber-400" : "bg-blue-400"}`}
                        style={{ width: `${memPct}%` }}
                      />
                    </div>
                    <div className="text-center text-muted-foreground" style={{ fontSize: "9px" }}>{memPct.toFixed(0)}%m</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-4 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded border-2 border-green-500 bg-green-50"></div>
              <span>Active</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded border-2 border-amber-400 bg-amber-50"></div>
              <span>Idle (Allocated)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded border-2 border-gray-200 bg-gray-50"></div>
              <span>Free</span>
            </div>
          </div>
        </div>

        {/* User Breakdown */}
        {stats.users.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Active Users</h4>
            <div className="space-y-2">
              {stats.users.map((user) => {
                const idleGPUs = stats.idle_allocated_gpus
                  .filter((g) => g.user === user.user)
                  .map((g) => g.gpu);
                return (
                  <div
                    key={user.user}
                    className="border rounded-lg p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm">{user.user}</span>
                      <div className="flex items-center gap-2">
                        {idleGPUs.length > 0 && (
                          <Badge variant="outline" className="text-amber-600 border-amber-600 text-xs">
                            {idleGPUs.length} idle
                          </Badge>
                        )}
                        <Badge variant="secondary">
                          {user.gpu_indices.length} GPU{user.gpu_indices.length !== 1 ? 's' : ''}
                        </Badge>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      GPUs: {user.gpu_indices.join(", ")}
                      {idleGPUs.length > 0 && (
                        <span className="text-amber-600 ml-1">(idle: {idleGPUs.join(", ")})</span>
                      )}
                    </div>
                    {(() => {
                      const memPct = user.mem_total_mb > 0 ? (user.mem_used_mb / user.mem_total_mb) * 100 : 0;
                      return (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Memory</span>
                            <span>
                              {(user.mem_used_mb / 1024).toFixed(1)} / {(user.mem_total_mb / 1024).toFixed(0)} GB
                              <span className={`ml-1 font-medium ${memPct < 20 ? "text-red-500" : memPct < 50 ? "text-amber-500" : "text-blue-500"}`}>
                                ({memPct.toFixed(0)}%)
                              </span>
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${memPct < 20 ? "bg-red-400" : memPct < 50 ? "bg-amber-400" : "bg-blue-400"}`}
                              style={{ width: `${memPct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
