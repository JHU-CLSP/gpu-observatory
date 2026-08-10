# ARCH ColdFront REST API — Integration Brief

**Purpose of this document:** you are adding a new data source to an existing backend
that displays GPU/cluster resource stats. This brief describes the API. It is derived
from the vendor help page and is *incomplete by design* — read §0 before writing code.

---

## Goal

Extend the existing stats backend to pull cluster usage data (jobs, CPU hours, GPU
hours, allocations) from the ARCH ColdFront portal REST API and surface it alongside
the stats already displayed. Read-only. Do not build job-submission features (§7).

---

## 0. Before writing code — discovery steps

The source doc lists endpoint paths and filters but **does not specify response
schemas**. Do not guess field names. Run these first and shape the code around what
comes back.

```bash
export CF_BASE="https://portal.arch.jhu.edu/api/v1"
export CF_TOKEN="<token>"   # never hardcode; see §1

# 1. Confirm auth works and see the endpoint index
curl -sH "Authorization: Token $CF_TOKEN" "$CF_BASE/" | jq .

# 2. Shape of a single job record — the most important unknown
curl -sH "Authorization: Token $CF_TOKEN" "$CF_BASE/jobs/?user=$USER" | jq '.results[0]'

# 3. Shape of the aggregate endpoint — likely the primary data source
curl -sH "Authorization: Token $CF_TOKEN" "$CF_BASE/jobs/summary/?user=$USER" | jq .

# 4. Allocation records
curl -sH "Authorization: Token $CF_TOKEN" "$CF_BASE/allocations/" | jq '.results[0]'
```

The browsable HTML UI at `$CF_BASE/` shows the **full filter set per endpoint**, which
is broader than what this brief lists. Check it before assuming a filter doesn't exist.

**Specifically unknown and must be discovered:**

- Exact field names for GPU hours vs. CPU hours in `/jobs/summary/`
- Pagination style (page-number vs. limit/offset) and default page size
- Whether `/jobs/summary/` accepts a `group_by`-style parameter
- Date/time format and timezone in job records
- Rate limits (none documented — assume they exist, be conservative)

---

## 1. Connection & auth

| Item | Value |
|---|---|
| Base URL | `https://portal.arch.jhu.edu/api/v1` |
| Auth header | `Authorization: Token <token>` |
| Scheme | Django REST Framework `TokenAuthentication` |
| Token scope | **Per-user.** Requests are scoped to that user's visible data. |
| Token lifetime | **Expires monthly** (see §6) |

Rules:

- Read base URL and token from config/env (`CF_API`, `CF_TOKEN` are the names the
  vendor's own examples use). Never commit the token, never log it, never return it
  in an API response or error payload.
- The token grants full impersonation of that user — treat it as a password-grade
  secret in whatever secret store this project already uses.
- Use one persistent HTTP session/client with the auth header set once, not a new
  connection per request.

---

## 2. Endpoints

Only the GET endpoints are in scope.

| Path | Method | Purpose | Relevance |
|---|---|---|---|
| `/jobs/summary/` | GET | Aggregates — job counts, CPU hours, GPU hours | **Primary source for dashboard stats** |
| `/jobs/` | GET | Individual job history (SlurmJob records) | Drill-down / per-job detail |
| `/allocations/` | GET | Your allocations | Quota vs. usage context |
| `/projects/` | GET | Your projects | Grouping / labels |
| `/partitions/` | GET | Slurm partitions | Grouping / labels |
| `/clusters/` | GET | Slurm clusters | Grouping / labels |
| `/qos/` | GET | QoS definitions | Reference data |
| `/resources/` | GET | Resources | Reference data |
| `/users/` | GET | Users (scoped) | Reference data |
| `/affiliations/` | GET | JHU/Schmidt codes | Reference data |
| `/auth/token/` | POST | `username`+`password` → fresh token | Token refresh only (§6) |

Prefer `/jobs/summary/` over aggregating `/jobs/` client-side. The server already does
the rollup; pulling raw job rows to sum them yourself is slower, heavier on the portal,
and will disagree with the portal's own numbers at the margins.

The reference endpoints (`/clusters/`, `/partitions/`, `/qos/`, `/resources/`,
`/affiliations/`) change rarely — fetch once at startup or cache for hours, not per
request.

---

## 3. Query filters

Documented as available on most list endpoints:

- `?user=<username>`
- `?project__pi__username=<username>`
- `?start_time__gte=YYYY-MM-DD`

The pattern is Django ORM lookups exposed as query params, so `__lte`, `__gt`, and
related-model traversal (`foo__bar__baz`) very likely work too — **verify against the
browsable UI rather than assuming**. A filter the server doesn't recognize may be
silently ignored rather than rejected, which would produce wrong numbers with no error.
After implementing a filter, sanity-check that changing it actually changes the result
count.

---

## 4. Response shapes

Confirmed from the vendor's own working examples:

**List endpoints** are DRF-paginated — the response is an object containing a `count`
key, with records under `results`:

```python
jobs = S.get(f"{BASE}/jobs/", params={...}).json()
print(jobs["count"], "jobs")
```

Implement pagination following. Do not assume the first page is the whole dataset.

**Everything else is unverified.** Field names for the summary payload, job records,
and allocation records are not documented. Discover them (§0), then write a thin
mapping layer so a schema change on their side breaks in one place instead of
throughout the codebase.

---

## 5. Errors

| Status | Meaning | Handling |
|---|---|---|
| `401` | Token expired (body: *Token has expired*) or invalid | See §6. Surface clearly — do not retry blindly in a loop. |
| `402` | Cost-confirmation rejected | Submission path only — out of scope. |
| `403` | Authenticated but not permitted for that resource | Surface; don't retry. |
| `404` | Bad path, or record outside your scope | Surface; don't retry. |
| `429` / `5xx` | Rate limit or server-side failure | Retry with exponential backoff + jitter, capped attempts. |

The portal is shared infrastructure. Cache aggressively, use the coarsest endpoint that
answers the question, and back off on failure rather than hammering.

---

## 6. Token expiry — decision needed

Tokens expire **monthly**. An expired token returns `401`. The web flow is "click
Regenerate on the User Profile page," which does not work for an unattended backend.

`POST /api/v1/auth/token/` with `username` + `password` returns a fresh token and
**rotates it if expired**. Two viable strategies:

**A — Stored credentials, auto-refresh.** Store username+password in the secret store;
on `401`, call `/auth/token/`, cache the new token, retry the original request once.
Fully unattended. Cost: the backend now holds full account credentials, which is a
strictly larger blast radius than holding a token.

**B — Manual token rotation.** Store only the token. On `401`, fail the ARCH data
source gracefully, keep the rest of the dashboard working, and emit a loud alert that a
human needs to rotate the token. Cost: monthly manual touch.

Do not silently swallow the `401` under either strategy — a dashboard showing stale or
empty GPU numbers with no indication that its data source is down is worse than one
showing an error.

Ask the user which strategy they want before implementing.

---

## 7. Out of scope — job submission

The API also supports submitting Slurm jobs (`POST /jobs/estimate/` then
`POST /jobs/submit/`, with a cost-confirmation handshake where the server rejects with
`402` if your estimate diverges >±5% from its recomputation). **A stats dashboard has
no reason to submit jobs.** Do not implement this. Do not add it speculatively "in case
it's useful later." If the user later wants it, it's a separate task with its own
review — a bug in a display feature shows wrong numbers, a bug in a submission feature
spends real money on a paid allocation.

---

## 8. Implementation checklist

- [ ] Run §0 discovery; record actual response shapes in a comment or fixture file
- [ ] Config: base URL + token from env/secret store, no hardcoded values
- [ ] Single reusable HTTP client with auth header and a sane timeout
- [ ] Pagination handling on all list endpoints
- [ ] Caching layer — reference data cached long, job stats cached short
- [ ] Error handling per §5, with backoff on `429`/`5xx`
- [ ] Token-expiry strategy per §6 (confirm choice with user first)
- [ ] Mapping layer isolating upstream field names from internal models
- [ ] Graceful degradation: ARCH source failing must not take down the whole dashboard
- [ ] Tests against recorded fixtures, not the live portal
