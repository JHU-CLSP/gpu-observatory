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
  return "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400"; // down, down*, not_resp
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

interface H200ServerCardProps {
  stats: DSAIStats | null;
  error?: string | null;
}

export function H200ServerCard({ stats, error }: H200ServerCardProps) {
  const h200 = stats?.h200 ?? null;

  if (!stats || !h200) {
    return (
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-teal-600" />
              <CardTitle>DSAI Cluster (Condo)</CardTitle>
            </div>
            <Badge variant="outline" className="text-teal-700 border-teal-600">H200</Badge>
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

  const teamPct = h200.team_limit > 0 ? (h200.team_gpus_used / h200.team_limit) * 100 : 0;
  const clusterPct = h200.total_gpus_available > 0
    ? (h200.total_gpus_used / h200.total_gpus_available) * 100
    : 0;

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="h-5 w-5 text-teal-600" />
            <CardTitle>DSAI Cluster (Condo)</CardTitle>
          </div>
          <Badge variant="outline" className="text-teal-700 border-teal-600">H200</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Team allocation */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Team Allocation</span>
            <span className="font-bold">
              {h200.team_gpus_used} / {h200.team_limit} GPUs
            </span>
          </div>
          <Progress value={teamPct} className="h-2" />
          <p className="text-xs text-muted-foreground">{teamPct.toFixed(1)}% of condo allocation</p>
        </div>

        {/* Cluster utilisation */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>Cluster Utilization (all users)</span>
            <span className="font-bold">
              {h200.total_gpus_used} / {h200.total_gpus_available > 0 ? h200.total_gpus_available : "?"} GPUs
            </span>
          </div>
          {h200.total_gpus_available > 0 && <Progress value={clusterPct} className="h-2" />}
          {h200.nodes && h200.nodes.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {h200.nodes.map((n) => <NodePill key={n.node} n={n} />)}
            </div>
          )}
        </div>


        {/* Running jobs */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">
            Running Jobs
            {h200.running_jobs.length === 0 && (
              <span className="ml-2 text-muted-foreground font-normal">none</span>
            )}
          </h4>
          {h200.running_jobs.length > 0 && (
            <div className="space-y-2">
              {h200.running_jobs.map((job) => {
                const isTeam = job.account === "dkhasha1";
                return (
                  <div
                    key={job.jobid}
                    className={`flex items-center justify-between text-sm border-b pb-2 last:border-0`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">{job.user}</span>
                      {isTeam && (
                        <Badge variant="outline" className="text-teal-700 border-teal-500 text-xs py-0">
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
        {h200.pending_jobs.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4 text-teal-600" />
              Pending Queue
              <Badge variant="outline" className="text-teal-700 border-teal-600 text-xs">
                {h200.pending_jobs.length} jobs · {h200.pending_summary.total_gpus_requested} GPUs
              </Badge>
            </h4>
            <div className="space-y-1">
              {(h200.pending_jobs as H200PendingJob[]).map((job) => (
                <div
                  key={job.jobid}
                  className="text-xs bg-teal-50 dark:bg-teal-950/40 p-2 rounded flex items-center justify-between"
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
