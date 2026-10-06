import { SkipjackFairShare as SkipjackFairShareData, SkipjackFairShareNode } from "../types/gpu-stats";
import { ReactNode } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(v < 0.01 && v > 0 ? 2 : 1)}%`);

// LevelFS >= 1: at/under share (good). Below that the account is out-using its
// share and Fair Tree ranks it behind its siblings.
function levelFsClass(v: number | null): string {
  if (v == null) return "text-muted-foreground";
  if (v >= 1) return "text-green-600";
  if (v >= 0.5) return "text-amber-600";
  return "text-red-600";
}

function formatLevelFs(node: SkipjackFairShareNode): string {
  if (node.unused) return "unused";
  if (node.level_fs == null) return "—";
  return node.level_fs.toFixed(2);
}

// Pending jobs' fair-share factor is compared with the cluster's median, since
// a factor is only meaningful relative to what everyone else's jobs get.
function factorClass(v: number | null, median: number | null): string {
  if (v == null || median == null || median === 0) return "";
  const ratio = v / median;
  if (ratio >= 0.8) return "text-green-600";
  if (ratio >= 0.3) return "text-amber-600";
  return "text-red-600";
}

const DEFINITIONS = {
  account:
    "A Slurm account jobs are charged to (--account). Indented accounts sit under the account above them, and only compete with their siblings there.",
  share:
    "NormShares: this account's slice of its parent's allocation, relative to its siblings. Set by the cluster admins; 0% means the account is entitled to nothing at that level.",
  usage:
    "EffectvUsage: this account's portion of its parent's recent GPU/CPU usage. Older usage counts less (30-day half-life) and everything resets monthly.",
  levelFs:
    "Share ÷ Usage. Fair Tree orders sibling accounts by this: above 1 = using less than its share (ranked ahead), below 1 = using more (ranked behind). \"unused\" = no recorded usage at all.",
  jobFs:
    "Median fair-share factor (0–1) of this account's pending jobs, as computed by sprio after the whole tree (department → group → account → user) is applied. Multiplied by the fair-share weight, it's the biggest part of job priority. Count of pending jobs in brackets.",
  ancestorLevelFs:
    "LevelFS of this department-level account among its siblings. A low value here pulls down every group underneath it, including ours.",
  pi:
    "Our PI group account, the parent of all team accounts: its portion of usage within the department vs its share of the department.",
  clusterMedian:
    "Median Job FS of every pending job on Skipjack, for comparison. Job FS is only meaningful relative to what other jobs get.",
};

function Hint({ text, children, className = "" }: { text: string; children: ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-2 ${className}`}>
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

export function SkipjackFairShare({ data }: { data: SkipjackFairShareData }) {
  const median = data.cluster_median_pending_fs_factor;
  const chain = [...data.ancestors].reverse();

  return (
    <TooltipProvider>
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <h4 className="text-sm font-semibold">Fair Share</h4>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="text-muted-foreground hover:text-foreground" aria-label="About fair share">
                <Info className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs space-y-1.5">
              <p>
                Skipjack ranks pending jobs mostly by fair share
                {data.weight != null && <> (weight {data.weight.toLocaleString()})</>}, using Slurm's Fair Tree:
                at each level of the account tree, siblings are ordered by <strong>LevelFS</strong> = share ÷ usage.
                Above 1 means under-using its share; below 1 means over-using.
              </p>
              <p>
                Usage decays with a 30-day half-life and resets monthly. <strong>Job FS</strong> is the median
                fair-share factor (0–1) of an account's pending jobs after the whole tree is applied — that's what
                actually enters priority.
              </p>
            </TooltipContent>
          </Tooltip>
      </div>

      {/* Where the team sits above its own accounts - the department-level
          standing caps everyone in the group. */}
      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
        {chain.map((n) => (
          <span key={n.account}>
            <Hint text={DEFINITIONS.ancestorLevelFs}>
              <span className="font-mono">{n.account}</span>{" "}
              <span className={levelFsClass(n.level_fs)}>{formatLevelFs(n)}</span>
            </Hint>
          </span>
        ))}
        <span>
          <Hint text={DEFINITIONS.pi}>
            <span className="font-mono">{data.pi.account}</span>: {pct(data.pi.effective_usage)} of usage vs{" "}
            {pct(data.pi.norm_shares)} share
          </Hint>
        </span>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="text-muted-foreground border-b">
            <th className="py-1.5 text-left font-medium"><Hint text={DEFINITIONS.account}>Account</Hint></th>
            <th className="py-1.5 text-right font-medium"><Hint text={DEFINITIONS.share}>Share</Hint></th>
            <th className="py-1.5 text-right font-medium"><Hint text={DEFINITIONS.usage}>Usage</Hint></th>
            <th className="py-1.5 text-right font-medium"><Hint text={DEFINITIONS.levelFs}>LevelFS</Hint></th>
            <th className="py-1.5 text-right font-medium"><Hint text={DEFINITIONS.jobFs}>Job FS</Hint></th>
          </tr>
        </thead>
        <tbody>
          {data.accounts.map((a) => (
            <tr key={a.account} className="border-b last:border-0">
              <td className="py-1 font-mono truncate" style={{ paddingLeft: `${a.depth * 0.75}rem` }}>
                {a.depth > 0 && <span className="text-muted-foreground">└ </span>}
                {a.account}
              </td>
              <td className="py-1 text-right font-mono">{pct(a.norm_shares)}</td>
              <td className="py-1 text-right font-mono">{pct(a.effective_usage)}</td>
              <td className={`py-1 text-right font-mono ${levelFsClass(a.level_fs)}`}>{formatLevelFs(a)}</td>
              <td className={`py-1 text-right font-mono ${factorClass(a.pending_fs_factor, median)}`}>
                {a.pending_fs_factor != null ? (
                  <>
                    {a.pending_fs_factor.toFixed(3)}
                    <span className="text-muted-foreground"> ({a.pending_jobs})</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {median != null && (
        <p className="text-xs text-muted-foreground">
          <Hint text={DEFINITIONS.clusterMedian}>Cluster median Job FS</Hint> across all pending jobs:{" "}
          <span className="font-mono">{median.toFixed(3)}</span>.
          Share/Usage are relative to each account's parent.
        </p>
      )}
    </div>
    </TooltipProvider>
  );
}
