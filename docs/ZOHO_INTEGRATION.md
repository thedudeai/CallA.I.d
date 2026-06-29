# Zoho Integration

Implements `CallAId_Zoho_Integration_Spec.md`: every call CallA.I.d scores is
mirrored into the tenant's Zoho org — **sales → Zoho CRM**, **care → Zoho Desk** —
with per-rep attribution via Owner/Assignee.

It follows the project's adapter pattern: a real OAuth + REST implementation, plus
a **sandbox mode** so the whole flow is demoable and testable without a live Zoho
org or credentials.

## How it works

```
post-call analysis (REST /calls/analyze or live HUD end)
        │  enqueueSync(company, call)   ← async, never blocks the UI
        ▼
 zoho_sync_jobs ──► syncCall()  (idempotent: guards on calls.zoho_record_id)
        │
        ├── mode = sales ─► CRM: upsert Contact → create Call → Tasks → Event
        └── mode = care  ─► Desk: upsert Contact → Ticket → Comment(summary) → Tasks
        ▼
 write zoho_record_id + zoho_sync_status on the call; mirror every record; audit-log
```

- **One OAuth grant per company.** The admin authorizes once; one encrypted
  refresh token per tenant. Per-rep attribution is by **Owner/Assignee**, mapped
  per product (CRM user id + Desk agent id), auto-matched by email at connect.
- **Multi-DC.** Authorization always starts at `accounts.zoho.com`; the callback's
  `location`/`accounts-server` pin the tenant's data center, and the token
  response's `api_domain` is the authoritative CRM domain.
- **Tokens.** Access tokens cached in memory and refreshed proactively (~5 min
  before expiry); refreshes are serialized per tenant; repeated 401s flip the
  integration to `needs_reauth` and surface a reconnect banner.
- **Idempotent + async.** Jobs never block the HUD/call-log; re-runs check
  `zoho_record_id` (and per-task `zoho_task_id`) so retries don't duplicate.

## Configuration

| Env var | Purpose |
|---|---|
| `CALLAID_ZOHO_CLIENT_ID` / `CALLAID_ZOHO_CLIENT_SECRET` | The one platform-wide, **server-based, multi-DC** OAuth client (Zoho API Console). Absent → sandbox mode. |
| `CALLAID_ZOHO_REDIRECT_URI` | Must match the registered redirect exactly (default `http://localhost:4000/api/zoho/callback`). |
| `CALLAID_ZOHO_CRM_VERSION` | CRM API version (default `v8`). |

When no client is configured, **Connect Zoho** runs a sandbox connection: it
simulates a Zoho org (CRM users + Desk agents derived from the tenant's reps, so
email auto-matching works) and records every "pushed" record to the `zoho_mirror`
table. Settings → *Records pushed to Zoho* and each call's **Zoho** block show
exactly what was (or would be) written.

## API

```
GET   /api/zoho/status                 GET  /api/zoho/mappings
POST  /api/zoho/connect (→ auth_url | sandbox)   PATCH /api/zoho/mappings/:userId
POST  /api/zoho/connect/sandbox        PUT  /api/zoho/defaults
GET   /api/zoho/callback  (public OAuth redirect target)
POST  /api/zoho/disconnect             GET  /api/zoho/records
POST  /api/zoho/sync/:callId           (manual re-sync / historical backfill)
```

## Resolved open decisions (spec §10)

1. **Care-ticket matching:** a **new Ticket per care call** (simplest, idempotent).
2. **Desk department:** a single **default department per tenant**, set at connect.
3. **Follow-ups:** sales → **CRM Events**; care → **Desk Tasks** with a due date.
4. **Custom fields:** score/gap are sent as `CallAId_Score`/`CallAId_Gap` (CRM) and
   `cf_callaid_score`/`cf_callaid_gap` (Desk). Create these once per tenant as a
   documented setup step (not auto-created via the metadata API in v1).
5. **Backfill:** new calls sync automatically; any historical call can be pushed
   on demand via the **Sync to Zoho** button (the `/zoho/sync/:callId` route).
6. **Direction:** push-only (CallA.I.d → Zoho) in v1. Reading Zoho contact history
   into the live HUD caller card is a documented future step.

## To confirm before a production launch

The spec flags these; they're encoded as configurable constants in
`server/src/integrations/zoho/config.js`, not hardcoded deep in logic:

- Exact scope strings (CRM + Desk, single consent).
- Per-DC Desk API base hosts (`ca`/`sa`/`cn` marked *(confirm)*).
- CRM API version (currently `v8`).

The Zoho developer docs were unreachable from the build environment, so these
follow the integration spec's documented values — verify against the live docs
(linked in the spec) when wiring a real client.
