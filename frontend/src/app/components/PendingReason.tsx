import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

export type ReasonCategory = "capacity" | "quota" | "access" | "scheduling";

export const REASON_CATEGORY_INFO: Record<ReasonCategory, { title: string; detail: string }> = {
  capacity: {
    title: "Waiting for capacity",
    detail: "No free GPUs right now, or the job is behind higher-priority jobs in line — it'll start once resources free up.",
  },
  quota: {
    title: "Quota / limit reached",
    detail: "A per-user or per-account GPU, job-count, or walltime limit under this QOS/account is currently exhausted.",
  },
  access: {
    title: "Access / configuration issue",
    detail: "The account, QOS, or partition combination the job requested isn't permitted — usually needs an admin to fix, or the job resubmitted differently.",
  },
  scheduling: {
    title: "Scheduling dependency",
    detail: "Waiting on another job to finish, a future start time, or a re-launch after a prior failure.",
  },
};

// Maps SLURM pending reason codes to plain-English explanations.
export const SLURM_REASON: Record<string, { label: string; detail: string; category: ReasonCategory }> = {
  Resources:              { label: "No free GPUs",        detail: "Not enough free GPUs are available right now", category: "capacity" },
  Priority:               { label: "Lower priority",      detail: "Waiting behind higher-priority jobs in the queue", category: "capacity" },
  QOSMaxGRESPerUser:      { label: "QOS GPU limit",       detail: "Your per-user GPU quota under this QOS is exhausted", category: "quota" },
  QOSMaxJobsPerUser:      { label: "QOS job limit",       detail: "Your per-user running-job quota under this QOS is exhausted", category: "quota" },
  QOSGrpGRES:             { label: "QOS group GPU limit", detail: "The group GPU quota for this QOS is exhausted", category: "quota" },
  AssocMaxGRESPerUser:    { label: "Account GPU limit",   detail: "Your team's condo GPU allocation is fully used", category: "quota" },
  AssocGrpGRES:           { label: "Account group limit", detail: "The group GPU limit for the dkhasha1 account is reached", category: "quota" },
  AssocMaxJobsPerUser:    { label: "Account job limit",   detail: "Your per-user job count limit for this account is reached", category: "quota" },
  ReqNodeNotAvail:        { label: "Node unavailable",    detail: "The requested node is down, drained, or reserved", category: "capacity" },
  InvalidAccount:         { label: "Invalid account",     detail: "The account isn't permitted to run on the requested partition or QOS", category: "access" },
  InvalidQOS:             { label: "Invalid QOS",         detail: "The requested QOS isn't permitted for this account or partition", category: "access" },
  Dependency:             { label: "Dependency",          detail: "Job is waiting for another job to complete first", category: "scheduling" },
  BeginTime:              { label: "Scheduled start",     detail: "Job has a future start time set", category: "scheduling" },
  PartitionTimeLimit:     { label: "Time limit",          detail: "Requested walltime exceeds the partition limit", category: "quota" },
  QOSMaxWallDurationPerJob: { label: "Walltime limit",   detail: "Requested walltime exceeds the QOS maximum", category: "quota" },
  JobArrayTaskLimit:      { label: "Array task limit",    detail: "Maximum concurrent array tasks reached", category: "quota" },
  "launch failed requeued held": { label: "Launch failed", detail: "Job failed to launch and was re-queued in held state", category: "scheduling" },
};

export interface PartitionAclInfo {
  allow_accounts: string | null;
  deny_accounts: string | null;
}

export interface AccountAccessContext {
  /** The account the job was submitted under, e.g. "dkhasha1" */
  account: string;
  /** Raw partition field from squeue, e.g. "a100,h200" (comma-separated, no spaces) */
  partitions: string;
  partitionAcl: Record<string, PartitionAclInfo>;
}

function buildAccessDetail(ctx: AccountAccessContext): string {
  const requested = ctx.partitions.split(",").map((p) => p.trim()).filter(Boolean);
  const described = requested.map((p) => {
    const acl = ctx.partitionAcl[p];
    if (!acl?.allow_accounts) return p;
    return `${p} (allows: ${acl.allow_accounts})`;
  });
  return `Account '${ctx.account}' isn't permitted on the requested partition${requested.length > 1 ? "s" : ""}: ${described.join(", ")}. An admin needs to add this account's association, or the job should target a partition that already allows it.`;
}

export function PendingReason({
  reason,
  accessContext,
  scheduledStart,
}: {
  reason: string;
  accessContext?: AccountAccessContext;
  /** UTC ISO-8601 timestamp of Slurm's scheduled/estimated start time, if known. */
  scheduledStart?: string | null;
}) {
  if (!reason) return null;
  const known = SLURM_REASON[reason];
  const label = known ? known.label : reason;
  const isAccessIssue = known?.category === "access" || reason === "InvalidAccount" || reason === "InvalidQOS";
  const specific = isAccessIssue && accessContext ? buildAccessDetail(accessContext) : null;
  let detail = specific ?? (known ? `${reason}: ${known.detail}` : reason);
  const startDate = scheduledStart ? new Date(scheduledStart) : null;
  const startLabel = startDate && !Number.isNaN(startDate.getTime()) ? startDate.toLocaleString() : null;
  if (startLabel) {
    detail = `${detail} Scheduled to start ~${startLabel}.`;
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help underline decoration-dotted text-muted-foreground">
            {label}
            {startLabel ? ` (~${startLabel})` : ""}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {detail}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function PendingReasonLegend() {
  return (
    <div className="text-xs border rounded-md p-2 bg-muted/40 space-y-1">
      <p className="font-medium text-foreground">Why jobs are pending</p>
      <ul className="space-y-0.5 pl-4 list-disc text-muted-foreground">
        {(Object.keys(REASON_CATEGORY_INFO) as ReasonCategory[]).map((key) => {
          const cat = REASON_CATEGORY_INFO[key];
          return (
            <li key={key}>
              <span className="font-medium text-foreground">{cat.title}:</span> {cat.detail}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
