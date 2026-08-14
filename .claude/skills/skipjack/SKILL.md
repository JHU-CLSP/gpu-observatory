---
name: skipjack
description: How to access Skipjack, the ARCH production cluster at JHU (login host, and the ColdFront REST API used for usage/accounting data). Use when the user asks about Skipjack, the ARCH portal, ColdFront, the CF_TOKEN, or GPU/CPU-hour accounting.
---

# Skipjack (ARCH)

Skipjack is the **ARCH production cluster** at JHU. For this dashboard, its data
comes **not over SSH** but from the **ARCH ColdFront REST API**, which is an
*accounting* API (Slurm job history — job counts, CPU/GPU/node hours). There is
**no live GPU telemetry** (no per-GPU util/memory) available through it.

## Interactive login (for running jobs)

```bash
ssh skipjack
```

Resolves to:

| | |
|---|---|
| HostName | `login.arch.jhu.edu` |
| User | `dkhasha1` |

GPU partitions on the cluster: `a100`, `b200`, `b300`, `h200` (SLURM).

## Usage/accounting via the ColdFront API

- **Base URL:** `https://portal.arch.jhu.edu/api/v1`
- **Auth:** `Authorization: Token <token>` (Django REST `TokenAuthentication`)
- **Token:** per-user, **expires monthly**. Read from `CF_TOKEN`/`TOKEN` env or the
  `TOKEN=` line in `.env` (gitignored). **Never commit, log, or print it.**

Token strategy is **manual rotation ("B")** — on a 401 the collector fails
gracefully and you regenerate the token on the ARCH portal *User Profile* page and
update `TOKEN` in `.env`. Do **not** re-add password-based auto-refresh (it would
store the PI account's full ARCH password). See `arch-api-integration.md` and the
`project-skipjack-token-strategy` memory.

Quick API probes:

```bash
export CF_BASE="https://portal.arch.jhu.edu/api/v1"
export CF_TOKEN="<token>"
curl -sH "Authorization: Token $CF_TOKEN" "$CF_BASE/" | jq .            # endpoint index
curl -sH "Authorization: Token $CF_TOKEN" "$CF_BASE/jobs/summary/" | jq .  # aggregates
```

Primary endpoint for dashboard stats is **`/jobs/summary/`** (server-side rollup);
prefer it over summing `/jobs/` client-side.

## Getting stats

```bash
python3 danielgpus_skipjack.py
```

Reports cluster + partition metadata, the team's ColdFront project + roster,
team-wide accounting (jobs, CPU/GPU/node hours), and per-member rollups. On an
expired token it emits a clear "rotate the token" error instead of crashing.

## Related

- [[ia1]], [[dsai-general]], [[dsai-rtx]], [[dsai-h200]] — the SSH-reachable resources.
