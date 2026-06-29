# CallA.I.d

**Real-time, AI-assisted call coaching for customer-service and sales reps.**

CallA.I.d listens to a rep's live phone call and gives them, in real time, the
next thing to say, the right tone, and the right pacing — then scores the call
afterward, extracts tasks and follow-ups, and reports performance to managers.
All guidance is derived from each company's own uploaded product material;
nothing is hard-coded per company.

This repository is a working, full-stack implementation of
[`CallAId_Build_Spec.md`](./CallAId_Build_Spec.md), rebuilt from the
`callaid_ui.html` design mockup (the visual source of truth).

---

## What's here

| Layer | Stack | Notes |
|---|---|---|
| **Backend** | Node + Express + `better-sqlite3` + `ws` | JWT auth, server-enforced RBAC, multi-tenant scoping, live WebSocket HUD loop |
| **AI engine** | Official `@anthropic-ai/sdk` + deterministic fallback | Provider-agnostic; live = Haiku-class, analysis = Opus-class; graceful degradation |
| **Frontend** | Vite + React + TypeScript | All seven screens, design tokens ported verbatim from the mockup |

The whole platform runs **with zero external keys** — a deterministic engine
produces realistic live cues, scoring, coaching, and task extraction. Add a
Claude API key per tenant (Settings → AI key) to switch that tenant to live
Claude guidance; the contract is identical either way.

---

## Quick start

```bash
# 1. Install everything + seed the demo database
npm run setup

# 2a. Production-style: build the SPA and serve it from the API on :4000
npm run build && npm start
#    → open http://localhost:4000

# 2b. Or dev mode with hot reload (two terminals):
npm run dev:server     # API + WS on :4000
npm run dev:web        # Vite dev server on :5173 (proxies /api and /calls/live)
```

### Demo logins (password `demo1234`)

| Email | Role | Sees |
|---|---|---|
| `dani@callaid.io` | Platform owner (super admin) | Super-admin portal; can open any tenant |
| `avery@northwind.example` | Company admin (Northwind) | Everything in the tenant, incl. reporting & settings |
| `priya@northwind.example` | Customer-service rep | Live HUD, own feedback, own call log, playbooks |
| `theo@northwind.example` | Sales rep | Same, sales mode |
| `june@` / `adam@northwind.example` | Reps | — |

> Try the flagship **On the call** screen: pick a playbook, **Start call**, then
> **▶ Play scenario** to stream a realistic conversation and watch the say-next
> cue, tone/pace gauges, energy match, discovery tracker, just-listen state, and
> live score update in real time. **End & score** runs post-call analysis and
> drops you on **My feedback**.

---

## Architecture

```
                         ┌──────────────────────────────────────────┐
  Browser (React SPA)    │  Express API (:4000)                      │
  ─ Live HUD ───WS──────►│  WS /calls/live  → live suggestion loop   │
  ─ REST  ──────HTTP────►│  /api/*          → auth, RBAC, tenants    │
                         │        │                                  │
                         │        ▼                                  │
                         │  AI engine façade ── tenant has key? ──┐  │
                         │     ├─ yes → Claude adapter (SDK)       │  │
                         │     └─ no / error → deterministic engine│  │
                         │        │ (RAG over tenant KB chunks)    │  │
                         │        ▼                                │  │
                         │  SQLite (every row scoped by company_id)│  │
                         └─────────────────────────────────────────┘
```

### Multi-tenancy & RBAC
- Every domain row carries `company_id`; every query is scoped by it.
- Four roles enforced **on the server** (`server/src/auth.js`): `super_admin`,
  `company_admin`, `sales_rep`, `customer_service_rep`.
- A rep sees only their own calls/feedback; cross-rep visibility requires
  `company_admin`. Tenant creation and company switching live only in the
  super-admin portal. Super-admin cross-tenant access is audit-logged.

### The AI engine (`server/src/ai/`)
- `index.js` — façade that picks Claude (if the tenant has a key) or the
  deterministic fallback, and degrades to fallback if a live call fails.
- `claude.js` — official Anthropic SDK adapter. Live guidance via forced
  tool-use (typed fields, never prose); post-call analysis via a stronger model
  with adaptive thinking + structured output.
- `fallback.js` — offline engine: transcript heuristics for tone/pace/energy,
  discovery-gate tracking, stage detection, scoring rubric, coaching, task &
  follow-up extraction, and auto playbook proposal.
- `rag.js` — knowledge ingestion + retrieval (chunk → lexical embed → retrieve),
  a self-contained stand-in for pgvector with an identical interface.
- `prompts.js` — mode/playbook/stage prompt templates and rubrics, kept as
  editable configuration.

### Live HUD loop (`server/src/live/gateway.js`)
A WebSocket carries transcript turns up and streams say-next cues, gauges,
stage, just-listen, and live score down (debounced, ~sub-second). On **end**,
the full transcript runs through post-call analysis and is persisted as a
completed call with scores, moments, tasks, and a calendar follow-up.

In production the up-frames come from Twilio Media Streams → streaming STT
(`server/src/routes/webhooks.js` is the provider-adapter ingress). Here the
in-browser **call simulator** feeds turns so the loop is fully exercisable.

---

## API surface (representative)

```
POST /api/auth/login            GET /api/me
GET/POST/PATCH /api/companies            (super admin)
GET/POST/PATCH/DELETE /api/users         (admin)
GET/PUT/DELETE /api/settings/api-key
GET/POST /api/settings/integrations
GET/POST/DELETE /api/kb/documents        (upload → index → auto-propose playbook)
GET/POST/PATCH/DELETE /api/playbooks
GET /api/playbook-proposals  · POST /api/playbook-proposals/:id/accept|dismiss
WS  /calls/live                          (live HUD: turns up, guidance down)
GET /api/calls · GET /api/calls/:id · POST /api/calls/analyze
GET /api/tasks · PATCH /api/tasks/:id
GET /api/reporting/team · GET /api/reporting/reps/:id   (admin)
POST /api/webhooks/telephony/:provider
```

---

## Screens

- **On the call** — live HUD: mode toggle, call-context bar + stage stepper,
  tone & pace gauges, energy match, say-next cue with alternatives, discovery
  tracker, just-listen state, live score — plus a call simulator.
- **My feedback** — single-call coaching: overall ring, rubric breakdown,
  timestamped moments, one concrete "try next time."
- **Call log** — history list + detail (AI summary, auto-extracted tasks,
  calendar follow-up).
- **Playbooks & modes** — default playbooks, AI-proposed modes (accept/dismiss),
  full CRUD.
- **Team reporting** *(admin)* — stat cards, rep leaderboard, rep drill-down.
- **Company & settings** *(admin)* — KB upload + auto-proposal, BYO AI key,
  phone integrations, themes, seats, team & roles.
- **Super admin** *(platform owner)* — platform stats, tenant table, create
  company, open a tenant to manage it.

---

## Configuration

Environment variables (all optional; sane dev defaults):

| Var | Purpose |
|---|---|
| `PORT` | API port (default `4000`) |
| `CALLAID_JWT_SECRET` | JWT signing secret |
| `CALLAID_SECRET` | Key-encryption secret (tenant API keys, AES-256-GCM at rest) |
| `CALLAID_DB` | SQLite path (default `server/data/callaid.db`) |
| `CALLAID_LIVE_MODEL` / `CALLAID_ANALYSIS_MODEL` | Override Claude models |

Re-seed at any time: `npm run seed` (use `node server/src/seed.js --reset` to wipe first).

---

## Mapping to the spec roadmap

- **Phase 0 — Foundations:** auth, multi-tenant model, company/user CRUD,
  super-admin create-company, RBAC, ported UI. ✅
- **Phase 1 — Knowledge + post-call:** KB upload + indexing (RAG), transcript →
  summary/scores/moments/coaching/tasks/follow-up, call log + feedback. ✅
- **Phase 2 — Live HUD:** WebSocket loop → live cue + gauges + stepper +
  discovery + just-listen, with the call simulator standing in for
  Twilio/STT. ✅
- **Phase 3 — Modes, playbooks & auto-proposal:** care vs sales, playbook CRUD,
  auto-propose from uploads, call-type awareness. ✅
- **Phase 4+:** reporting & rep drill-down, themes, seats. ✅ (calendar uses an
  internal event store; native Google/MS calendar and additional telephony
  adapters are the documented next steps.)

Production hardening called out in the spec (Postgres + row-level security,
streaming STT, recording-consent compliance, KMS-managed secrets, observability)
is intentionally scoped as the next milestone; the data model and engine
interfaces are shaped so those swaps are mechanical.
