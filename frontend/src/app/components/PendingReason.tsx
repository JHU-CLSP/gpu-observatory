import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

// Maps SLURM pending reason codes to plain-English explanations.
export const SLURM_REASON: Record<string, { label: string; detail: string }> = {
  Resources:              { label: "No free GPUs",        detail: "Not enough free GPUs are available right now" },
  Priority:               { label: "Lower priority",      detail: "Waiting behind higher-priority jobs in the queue" },
  QOSMaxGRESPerUser:      { label: "QOS GPU limit",       detail: "Your per-user GPU quota under this QOS is exhausted" },
  QOSMaxJobsPerUser:      { label: "QOS job limit",       detail: "Your per-user running-job quota under this QOS is exhausted" },
  QOSGrpGRES:             { label: "QOS group GPU limit", detail: "The group GPU quota for this QOS is exhausted" },
  AssocMaxGRESPerUser:    { label: "Account GPU limit",   detail: "Your team's condo GPU allocation is fully used" },
  AssocGrpGRES:           { label: "Account group limit", detail: "The group GPU limit for the dkhasha1 account is reached" },
  AssocMaxJobsPerUser:    { label: "Account job limit",   detail: "Your per-user job count limit for this account is reached" },
  ReqNodeNotAvail:        { label: "Node unavailable",    detail: "The requested node is down, drained, or reserved" },
  Dependency:             { label: "Dependency",          detail: "Job is waiting for another job to complete first" },
  BeginTime:              { label: "Scheduled start",     detail: "Job has a future start time set" },
  PartitionTimeLimit:     { label: "Time limit",          detail: "Requested walltime exceeds the partition limit" },
  QOSMaxWallDurationPerJob: { label: "Walltime limit",   detail: "Requested walltime exceeds the QOS maximum" },
  JobArrayTaskLimit:      { label: "Array task limit",    detail: "Maximum concurrent array tasks reached" },
  "launch failed requeued held": { label: "Launch failed", detail: "Job failed to launch and was re-queued in held state" },
};

export function PendingReason({ reason }: { reason: string }) {
  if (!reason) return null;
  const known = SLURM_REASON[reason];
  const label = known ? known.label : reason;
  const detail = known ? `${reason}: ${known.detail}` : reason;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help underline decoration-dotted text-muted-foreground">
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {detail}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
