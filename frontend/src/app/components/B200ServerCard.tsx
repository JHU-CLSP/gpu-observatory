import { DSAIStats, H200PendingJob, H200Node } from "../types/gpu-stats";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { Cpu, Clock, AlertCircle } from "lucide-react";
import { Progress } from "./ui/progress";
import { PendingReason } from "./PendingReason";

function nodeStateStyle(state: string): string {
  const s = state.toLowerCase().replace(/\*$/, "");
  if (s === "idle")      return "bg-green-100 text-green-700 dark:bg-green-950/60 dark:text-green-400";
  if (s === "mixed")     return "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400";
  if (s === "allocated") return "bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-400";
  if (s.startsWith("drain")) return "bg-gray-100 text-gray-500 dark:bg-gray-900 dark:text-gray-500";
  return "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400";
}

function NodePill({ n }: { n: H200Node }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`text-xs font-mono px-2 py-0.5 rounded cursor-default ${nodeStateStyle(n.state)}`}>
            {n.node}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">{n.state}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface B200ServerCardProps {
  stats: DSAIStats | null;
  error?: string | null;
}

export function B200ServerCard({ stats, error }: B200ServerCardProps) {
  const b200 = stats?.b200 ?? null;

  if (!stats || !b200) {
    return (
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-violet-600" />
              <CardTitle>DSAI Cluster (Condo)</CardTitle>
            </div>
            <Badge variant="outline" className="text-violet-700 border-violet-600">B200</Badge>
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

  const clusterPct = b200.total_gpus_available > 0
    ? (b200.total_gpus_used / b200.total_gpus_available) * 100
    : 0;

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-violet-600" />
            <CardTitle>DSAI Cluster (Condo)</CardTitle>
          </div>
          <Badge variant="outline" className="text-violet-700 border-violet-600">B200</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Team usage */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Team Usage</span>
            <span className="font-bold">{b200.team_gpus_used} GPUs</span>
          </div>
          <p className="text-xs text-muted-foreground">No fixed allocation limit (blackwell_test QOS)</p>
        </div>

        {/* Cluster utilisation */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>Cluster Utilization (all users)</span>
            <span className="font-bold">
              {b200.total_gpus_used} / {b200.total_gpus_available > 0 ? b200.total_gpus_available : "?"} GPUs
            </span>
          </div>
          {b200.total_gpus_available > 0 && <Progress value={clusterPct} className="h-2" />}
          {b200.nodes && b200.nodes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {b200.nodes.map((n) => <NodePill key={n.node} n={n} />)}
            </div>
          )}
        </div>

        {/* Running jobs */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">
            Running Jobs
            {b200.running_jobs.length === 0 && (
              <span className="ml-2 text-muted-foreground font-normal">none</span>
            )}
          </h4>
          {b200.running_jobs.length > 0 && (
            <div className="space-y-2">
              {b200.running_jobs.map((job) => {
                const isTeam = job.account === "dkhasha1";
                return (
                  <div
                    key={job.jobid}
                    className="flex items-center justify-between text-sm border-b pb-2 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{job.user}</span>
                      {isTeam && (
                        <Badge variant="outline" className="text-violet-700 border-violet-500 text-xs py-0">
                          team
                        </Badge>
                      )}
                    </div>
                    <span className="font-bold text-xs">{job.gpus} GPUs</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pending queue (team only) */}
        {b200.pending_jobs.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-violet-600" />
              Pending Queue
              <Badge variant="outline" className="text-violet-700 border-violet-600 text-xs">
                {b200.pending_jobs.length} jobs · {b200.pending_summary.total_gpus_requested} GPUs
              </Badge>
            </h4>
            <div className="space-y-1">
              {(b200.pending_jobs as H200PendingJob[]).map((job) => (
                <div
                  key={job.jobid}
                  className="text-xs bg-violet-50 dark:bg-violet-950/40 p-2 rounded flex items-center justify-between"
                >
                  <span className="font-mono">{job.user}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{job.gpus_requested} GPUs</span>
                    {job.reason && <PendingReason reason={job.reason} />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </CardContent>
    </Card>
  );
}
