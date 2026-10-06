import { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, CircleMinus, Lightbulb, Star } from "lucide-react";
import {
  SkipjackFairShare as SkipjackFairShareData,
  SkipjackFairShareAccount,
  SkipjackFairShareNode,
} from "../types/gpu-stats";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

// Written for people who have never heard of "fair share": every term that
// shows up on screen gets a plain-language hover definition here.
const DEFINITIONS = {
  fairShare:
    "Fair share is how Skipjack keeps things even between groups. Every account gets an allotment (its \"share\"). Accounts that have used less than their share recently get their jobs started first; accounts that used more wait longer.",
  priority:
    "When GPUs are busy, waiting jobs are lined up by a priority score. The highest score starts first when GPUs free up.",
  aheadOf:
    "Compares this account's fair-share score with every job currently waiting on Skipjack. \"Ahead of 30%\" means 30% of waiting jobs have a lower fair-share score, so on this factor alone you'd be in front of them.",
  share:
    "The slice of the group's allotment this account is entitled to, set by the cluster admins. It's compared with how much the account actually used.",
  usageVsShare:
    "How much this account has used compared with its share, relative to the other team accounts. 1× is exactly fair. Below 1× = under-used, so it gets a boost; above 1× = over-used, so its jobs rank lower.",
  pending: "Jobs submitted under this account that are still waiting to start.",
  runsOn: "Which GPU types jobs under this account can use, and any limit on how many GPUs it can hold at once.",
  budget:
    "A hard cap on total GPU time for this account. Once it's used up, new jobs here won't start until usage fades or resets.",
  account:
    "A Slurm account is what your job is charged to. Choose it with #SBATCH --account=NAME (or --account=NAME on srun/sbatch).",
  levelFs:
    "LevelFS = share ÷ usage, the number Slurm uses to rank sibling accounts. Above 1 = under-used (ranked ahead), below 1 = over-used (ranked behind). \"unused\" = no recent usage at all.",
  rawShare: "NormShares: this account's share among its siblings (0–100%).",
  rawUsage: "EffectvUsage: this account's portion of its parent's recent usage (0–100%).",
  factor:
    "Fair-share factor (0–1) a typical member's jobs get under this account, after the whole tree (department → group → account → you) is applied. It's multiplied by the fair-share weight in the priority score.",
  group:
    "Usage is counted at every level: department, group, then account. If a level above us has used more than its share, every account below it starts lower.",
};

// Validated (light + dark surfaces) for colour-blind separation; segments are
// also direct-labelled so identity never rests on colour alone.
const FACTOR_COLORS = { fairshare: "#6366f1", age: "#0d9488", job_size: "#d97706" };

function Hint({ text, children, className = "" }: { text: string; children: ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 ${className}`}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

const gpuLabel = (t: string) => t.toUpperCase();
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(v < 0.01 && v > 0 ? 2 : 1)}%`);
const ratioOf = (n: SkipjackFairShareNode) =>
  n.norm_shares && n.effective_usage != null ? n.effective_usage / n.norm_shares : null;
const fmtRatio = (r: number) => (r >= 10 ? r.toFixed(0) : r.toFixed(1));

// Standing in the queue, in words. Status colour always comes with an icon and
// a label.
function standing(aheadOf: number | null) {
  if (aheadOf == null) return { label: "Unknown", icon: CircleMinus, cls: "text-muted-foreground" };
  if (aheadOf >= 50) return { label: "Good", icon: CheckCircle2, cls: "text-green-600" };
  if (aheadOf >= 25) return { label: "Fair", icon: CircleAlert, cls: "text-amber-600" };
  if (aheadOf >= 10) return { label: "Low", icon: AlertTriangle, cls: "text-orange-600" };
  return { label: "Very low", icon: AlertTriangle, cls: "text-red-600" };
}

/** Where usage sits relative to the account's share, on a log scale from 0.1× to 10×. */
function UsageGauge({ ratio }: { ratio: number }) {
  const clamped = Math.min(10, Math.max(0.1, ratio));
  const pos = ((Math.log10(clamped) + 1) / 2) * 100;
  return (
    <div className="relative h-4" aria-hidden>
      <div className="absolute inset-x-0 top-1.5 h-1 rounded-full bg-gray-200 dark:bg-gray-700" />
      <div className="absolute top-0.5 h-3 w-px bg-gray-400 dark:bg-gray-500" style={{ left: "50%" }} />
      <div
        className="absolute top-0.5 h-3 w-3 -ml-1.5 rounded-full border-2 border-white dark:border-gray-800 bg-gray-700 dark:bg-gray-200"
        style={{ left: `${pos}%` }}
      />
    </div>
  );
}

function PriorityMix({ data }: { data: SkipjackFairShareData }) {
  const w = data.priority.weights;
  const parts = [
    {
      key: "fairshare" as const,
      label: "Fair share",
      value: w.fairshare,
      hint: "How much your account has used recently compared with its share. This is the part you can influence by choosing an account.",
    },
    {
      key: "age" as const,
      label: "Time waiting",
      value: w.age,
      hint: `Grows the longer a job waits, maxing out after ${data.priority.max_age_days ?? "?"} days. Every job gets this eventually.`,
    },
    {
      key: "job_size" as const,
      label: "Job size",
      value: w.job_size,
      hint: data.priority.favor_small
        ? "Smaller jobs (fewer GPUs/nodes) get a bonus."
        : "Bigger jobs (more GPUs/nodes) get a bonus, so they aren't starved by a stream of small jobs.",
    },
  ].filter((p) => p.value > 0);
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium">
        What decides <Hint text={DEFINITIONS.priority}>who starts next</Hint>
      </div>
      <div className="flex h-6 w-full gap-0.5 overflow-hidden rounded">
        {parts.map((p) => (
          <Tooltip key={p.key}>
            <TooltipTrigger asChild>
              <div
                className="flex items-center justify-center text-[11px] font-medium text-white cursor-help first:rounded-l last:rounded-r"
                style={{ width: `${(p.value / total) * 100}%`, backgroundColor: FACTOR_COLORS[p.key] }}
              >
                {p.label} {Math.round((p.value / total) * 100)}%
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              <strong>{p.label}</strong> — up to {Math.round((p.value / total) * 100)}% of the score. {p.hint}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function AccountCard({
  a,
  parent,
  generalTypes,
  bestFor,
}: {
  a: SkipjackFairShareAccount;
  parent: SkipjackFairShareAccount | undefined;
  generalTypes: string[];
  bestFor: string[];
}) {
  const st = standing(a.ahead_of_pct);
  const StIcon = st.icon;
  const types = a.gpu_types ?? generalTypes;
  const ratio = ratioOf(a);
  // An only child always shows 1×, which says nothing - its standing comes
  // from the parent, so describe the parent instead.
  const blockedByParent = parent != null && parent.norm_shares === 0;
  const limits = [
    a.gpu_cap != null && `max ${a.gpu_cap} GPUs for the whole account`,
    a.qos_gpus_per_user != null && `max ${a.qos_gpus_per_user} GPUs per person`,
  ].filter(Boolean);
  const budgetLeft =
    a.gpu_hours_budget != null ? Math.max(0, a.gpu_hours_budget - (a.gpu_hours_used ?? 0)) : null;

  return (
    <div className={`rounded-md border p-3 space-y-2 ${bestFor.length > 0 ? "border-indigo-400 dark:border-indigo-500" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Hint text={DEFINITIONS.account} className="font-mono text-sm font-semibold">
            {a.account}
          </Hint>
          <div className="text-xs text-muted-foreground mt-0.5">
            <Hint text={DEFINITIONS.runsOn}>Runs on</Hint>{" "}
            {a.gpu_types ? `${types.map(gpuLabel).join(", ")} only` : types.map(gpuLabel).join(", ")}
            {limits.length > 0 && ` · ${limits.join(", ")}`}
          </div>
        </div>
        {bestFor.length > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:text-indigo-300">
            <Star className="h-3 w-3" /> Best for {bestFor.map(gpuLabel).join(", ")}
          </span>
        )}
      </div>

      {/* Queue standing: the one number that answers "will my job start soon?" */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1">
            <StIcon className={`h-3.5 w-3.5 ${st.cls}`} />
            <span className="font-medium">{st.label} priority</span>
          </span>
          {a.ahead_of_pct != null && (
            <Hint text={DEFINITIONS.aheadOf} className="text-muted-foreground">
              ahead of {Math.round(a.ahead_of_pct)}% of waiting jobs
            </Hint>
          )}
        </div>
        <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{ width: `${a.ahead_of_pct ?? 0}%`, backgroundColor: FACTOR_COLORS.fairshare }}
          />
        </div>
      </div>

      {/* Why: usage vs share */}
      {blockedByParent ? (
        <div className="flex gap-1.5 text-xs text-red-700 dark:text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            It sits under <span className="font-mono">{parent!.account}</span>, which has <strong>no share</strong>{" "}
            (set to 0 by the admins). Jobs here go to the back of the line no matter how little this account is used.
          </span>
        </div>
      ) : a.unused ? (
        <div className="text-xs text-muted-foreground">Not used recently, so it gets the biggest boost.</div>
      ) : (
        ratio != null && (
          <div className="space-y-0.5">
            <div className="text-xs">
              <Hint text={DEFINITIONS.usageVsShare}>Used {fmtRatio(ratio)}× its share</Hint>{" "}
              <span className="text-muted-foreground">
                {ratio < 0.9
                  ? "— under its share, so its jobs get a boost"
                  : ratio <= 1.1
                    ? "— right at its share"
                    : "— over its share, so its jobs rank lower"}
              </span>
            </div>
            <UsageGauge ratio={ratio} />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>used less</span>
              <span>fair (1×)</span>
              <span>used more</span>
            </div>
          </div>
        )
      )}

      <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        <Hint text={DEFINITIONS.pending}>{a.pending_jobs} waiting jobs</Hint>
        {budgetLeft != null && (
          <Hint text={DEFINITIONS.budget}>
            {Math.round(budgetLeft).toLocaleString()} of {Math.round(a.gpu_hours_budget!).toLocaleString()} GPU-hours
            left
          </Hint>
        )}
      </div>
    </div>
  );
}

export function SkipjackFairShare({ data }: { data: SkipjackFairShareData }) {
  const generalTypes = data.general_gpu_types ?? [];
  const byName = new Map(data.accounts.map((a) => [a.account, a]));
  // Only leaf accounts can take jobs; grouping accounts appear through their
  // children's warnings instead.
  const leaves = data.accounts
    .filter((a) => !a.has_children)
    .sort((x, y) => (y.fs_factor ?? -1) - (x.fs_factor ?? -1));

  // Best account per GPU type: the highest fair-share score among accounts
  // that can run it and haven't spent their GPU-time budget.
  const typesOf = (a: SkipjackFairShareAccount) => a.gpu_types ?? generalTypes;
  const usable = (a: SkipjackFairShareAccount) =>
    a.fs_factor != null && (a.gpu_hours_budget == null || (a.gpu_hours_used ?? 0) < a.gpu_hours_budget);
  const allTypes = [...new Set([...generalTypes, ...leaves.flatMap(typesOf)])];
  const bestFor = new Map<string, string[]>();
  for (const t of allTypes) {
    const best = leaves.filter((a) => usable(a) && typesOf(a).includes(t))[0];
    if (best) bestFor.set(best.account, [...(bestFor.get(best.account) ?? []), t]);
  }

  // Our group and the levels above it, as "used N× its share".
  const chain = [data.pi, ...data.ancestors];
  const p = data.priority;

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="space-y-1">
          <h4 className="text-sm font-semibold">Which account should I submit to?</h4>
          <p className="text-xs text-muted-foreground">
            When GPUs are busy, Skipjack lines up waiting jobs by a score, and the biggest part of that score is{" "}
            <Hint text={DEFINITIONS.fairShare}>fair share</Hint>: accounts that have used <em>less</em> than their
            allotment lately go first. You pick the account with <code className="font-mono">--account=NAME</code>, so
            picking well can get your job started sooner.
          </p>
        </div>

        <PriorityMix data={data} />

        {bestFor.size > 0 && (
          <div className="rounded-md bg-indigo-50 dark:bg-indigo-950/40 p-3 text-xs space-y-1">
            <div className="font-medium flex items-center gap-1">
              <Star className="h-3.5 w-3.5 text-indigo-600" /> Best account right now, by GPU type
            </div>
            <ul className="space-y-0.5">
              {[...bestFor.entries()].map(([acct, types]) => (
                <li key={acct}>
                  {types.map(gpuLabel).join(", ")} → <code className="font-mono">--account={acct}</code>
                  {byName.get(acct)?.gpu_hours_budget != null && (
                    <span className="text-muted-foreground"> (has a limited GPU-hour budget)</span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-muted-foreground">
              Based on a typical team member. Your own score is a bit lower if you personally used that account a lot.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {leaves.map((a) => (
            <AccountCard
              key={a.account}
              a={a}
              parent={a.parent ? byName.get(a.parent) : undefined}
              generalTypes={generalTypes}
              bestFor={bestFor.get(a.account) ?? []}
            />
          ))}
        </div>

        <div className="text-xs space-y-1">
          <div className="font-medium">
            <Hint text={DEFINITIONS.group}>Our group's standing</Hint>
          </div>
          <ul className="text-muted-foreground space-y-0.5">
            {chain.map((n, i) => {
              const r = ratioOf(n);
              const parentName = data.ancestors[i]?.account;
              return (
                <li key={n.account}>
                  <span className="font-mono text-foreground">{n.account}</span>{" "}
                  {r == null
                    ? "has no recent usage"
                    : `used ${fmtRatio(r)}× its share${parentName ? ` within ${parentName}` : " of the cluster"}`}
                  {r != null && r > 1.1 && " — lowers priority for every account below it"}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="rounded-md border p-3 text-xs space-y-1.5">
          <div className="font-medium flex items-center gap-1">
            <Lightbulb className="h-3.5 w-3.5 text-amber-600" /> How to get your jobs started sooner
          </div>
          <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
            <li>
              <span className="text-foreground">Pick the best account for your GPU type</span> (see above) with{" "}
              <code className="font-mono">#SBATCH --account=NAME</code>. This is the biggest lever you have.
            </li>
            {p.backfill && (
              <li>
                <span className="text-foreground">Ask for a realistic time limit</span> (
                <code className="font-mono">--time</code>). Skipjack fills gaps with jobs that will finish before the
                GPUs are needed for others, so a short, accurate limit can start ahead of higher-priority jobs.
              </li>
            )}
            {p.weights.age > 0 && (
              <li>
                <span className="text-foreground">Waiting counts too.</span> A job's score rises the longer it waits,
                maxing out after {p.max_age_days ?? "?"} days, so don't cancel and resubmit; that resets the clock.
              </li>
            )}
            {p.decay_half_life_days != null && (
              <li>
                <span className="text-foreground">Usage fades.</span> Usage from {p.decay_half_life_days} days ago
                counts half as much
                {p.usage_reset && p.usage_reset !== "NONE" ? `, and everything resets ${p.usage_reset.toLowerCase()}` : ""}
                . A heavy burst this week lowers that account's priority for weeks.
              </li>
            )}
            <li>
              <span className="text-foreground">Usage is shared.</span> Everyone's jobs under an account count toward
              its usage, so heavy use by one person lowers that account's priority for the whole team. Within an
              account, whoever has used less goes first.
            </li>
          </ul>
        </div>

        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Technical details (raw Slurm numbers)
          </summary>
          <table className="w-full mt-2">
            <thead>
              <tr className="text-muted-foreground border-b">
                <th className="py-1.5 text-left font-medium">
                  <Hint text={DEFINITIONS.account}>Account</Hint>
                </th>
                <th className="py-1.5 text-right font-medium">
                  <Hint text={DEFINITIONS.rawShare}>Share</Hint>
                </th>
                <th className="py-1.5 text-right font-medium">
                  <Hint text={DEFINITIONS.rawUsage}>Usage</Hint>
                </th>
                <th className="py-1.5 text-right font-medium">
                  <Hint text={DEFINITIONS.levelFs}>LevelFS</Hint>
                </th>
                <th className="py-1.5 text-right font-medium">
                  <Hint text={DEFINITIONS.factor}>FS factor</Hint>
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ...[...data.ancestors].reverse().map((n, i) => ({ n, depth: i, factor: null })),
                { n: data.pi, depth: data.ancestors.length, factor: null },
                ...data.accounts.map((n) => ({ n, depth: data.ancestors.length + 1 + n.depth, factor: n.fs_factor })),
              ].map(({ n, depth, factor }) => {
                return (
                  <tr key={n.account} className="border-b last:border-0">
                    <td className="py-1 font-mono truncate" style={{ paddingLeft: `${depth * 0.75}rem` }}>
                      {depth > 0 && <span className="text-muted-foreground">└ </span>}
                      {n.account}
                    </td>
                    <td className="py-1 text-right font-mono">{pct(n.norm_shares)}</td>
                    <td className="py-1 text-right font-mono">{pct(n.effective_usage)}</td>
                    <td className="py-1 text-right font-mono">
                      {n.unused ? "unused" : n.level_fs != null ? n.level_fs.toFixed(2) : "—"}
                    </td>
                    <td className="py-1 text-right font-mono">{factor != null ? factor.toFixed(3) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.cluster_median_pending_fs_factor != null && (
            <p className="mt-1 text-muted-foreground">
              Median FS factor of all {data.cluster_pending_jobs.toLocaleString()} waiting jobs on Skipjack:{" "}
              <span className="font-mono">{data.cluster_median_pending_fs_factor.toFixed(3)}</span>
            </p>
          )}
        </details>
      </div>
    </TooltipProvider>
  );
}
