import { DSAIStats, H200PendingJob } from "../types/gpu-stats";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Cpu, Clock } from "lucide-react";
import { Progress } from "./ui/progress";

interface H200ServerCardProps {
  stats: DSAIStats;
}

export function H200ServerCard({ stats }: H200ServerCardProps) {
  const h200 = stats.h200;

  if (!h200) {
    return (
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-teal-600" />
              <CardTitle>DSAI Cluster (Condo)</CardTitle>
            </div>
            <Badge variant="outline">H200</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No H200 data available.</p>
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
        {h200.total_gpus_available > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span>Cluster Utilization (all users)</span>
              <span className="font-bold">
                {h200.total_gpus_used} / {h200.total_gpus_available} GPUs
              </span>
            </div>
            <Progress value={clusterPct} className="h-2" />
            <p className="text-xs text-muted-foreground">{clusterPct.toFixed(1)}% utilized across all accounts</p>
          </div>
        )}


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
              <Clock className="h-4 w-4 text-purple-500" />
              Pending Queue
              <Badge variant="outline" className="text-purple-600 border-purple-600 text-xs">
                {h200.pending_jobs.length} jobs · {h200.pending_summary.total_gpus_requested} GPUs
              </Badge>
            </h4>
            <div className="space-y-1">
              {(h200.pending_jobs as H200PendingJob[]).map((job) => (
                <div
                  key={job.jobid}
                  className="text-xs bg-purple-50 dark:bg-purple-950 p-2 rounded flex items-center justify-between"
                >
                  <span className="font-mono">{job.user}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{job.gpus_requested} GPUs</span>
                    {job.reason && (
                      <span className="text-purple-600 dark:text-purple-400">{job.reason}</span>
                    )}
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
