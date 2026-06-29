# CallA.I.d — Build & Launch Specification

**Version:** 1.0 (handoff draft)
**Prepared for:** Claude Code (development) + founding team
**Companion file:** `callaid_ui.html` (interactive front-end concept — the visual source of truth for screens, layout, and design tokens)

> Read this document top to bottom before writing code. It defines *what* to build and *why*. The HTML mockup defines *how it should look and feel*. Where this doc and the mockup disagree, this doc wins on behavior; the mockup wins on visual design.

---

## 1. One-line summary

CallA.I.d is a multi-tenant SaaS platform that listens to a customer-service or sales rep's live phone call and gives them, in real time, the next thing to say, the right tone, and the right pacing — then scores the call afterward, extracts tasks and follow-ups, and reports performance to managers. All guidance is derived from each company's own uploaded product material; nothing is hard-coded per company.

---

## 2. Goals & non-goals

**Goals**
- Real-time, glanceable, low-latency in-call assistance that raises customer-care quality and sales conversion.
- Fully generic: any company in any industry plugs in by uploading its own product docs and guidelines.
- Two assist modes (Customer care, Sales) that re-shape the guidance, plus extensible playbooks per mode.
- Closed loop: live assist → post-call scoring → coaching → tasks/follow-ups → manager reporting.
- Strict multi-tenant isolation, with a separate platform-owner (super-admin) layer.

**Non-goals (for v1)**
- Being a phone system / dialer. We integrate with existing phone systems; we do not replace them.
- Fully autonomous AI that talks to the customer. The human rep always speaks; AI only assists.
- Outbound campaign management, ticketing system replacement, or full CRM. We integrate, not replace.

---

## 3. Core concepts & glossary

| Term | Meaning |
|---|---|
| **Platform owner / Super admin** | Us. Operates CallA.I.d, creates and manages all tenant companies. |
| **Company (tenant)** | A customer business. Owns its own users, knowledge base, playbooks, API key, integrations, and data. Fully isolated from other tenants. |
| **User** | A person inside a company. Has a role and a default mode. |
| **Role** | `company_admin`, `sales_rep`, or `customer_service_rep` (plus platform-level `super_admin`). |
| **Mode** | `care` (customer service) or `sales`. Determines which gauges, stages, and cues appear. A user opens calls in their **default mode** but can switch. |
| **Playbook** | A configurable strategy *within* a mode (e.g. care: "De-escalation", "Guided support"; sales: "Physical product", "Service", "Software/SaaS"). Drives stages, discovery prompts, and scoring weights. |
| **Stage** | Where the call is in its arc. Care: Listen → Diagnose → Resolve → Confirm. Sales: Discovery → Problem → Solution → Close. Detected live. |
| **Call type / journey** | Sales: cold, inbound, follow-up/secondary, plus the touch number (e.g. "follow-up #3"). Care: new vs returning, Nth call. Detected/looked up at call start. |
| **Knowledge base (KB)** | The company's uploaded docs (product catalogue, brand voice, policies, guides). The AI reasons only from this. |
| **Live HUD** | The minimal on-screen overlay shown to the rep during a call. |
| **Gap** | The delta between the rep's score and the playbook's target — surfaced in feedback and reporting. |

---

## 4. Roles & permissions

Four roles. Enforce on the **server**, not just the UI.

| Capability | Super admin | Company admin | Sales rep | Care rep |
|---|---|---|---|---|
| Manage all tenant companies (create/suspend/billing) | ✅ | — | — | — |
| See data across companies | ✅ | — | — | — |
| Manage own company settings (KB, API key, phone, themes, seats) | — | ✅ | — | — |
| Add/edit/delete playbooks & modes | — | ✅ | — | — |
| Add/remove users, set roles & default modes | — | ✅ | — | — |
| View **all reps'** feedback, logs, reporting | — | ✅ | — | — |
| Use the live HUD on calls | — | ✅ (optional) | ✅ | ✅ |
| View **own** feedback & **own** call log | — | ✅ | ✅ | ✅ |

**Hard rules**
- A tenant user can only ever see their own company. No company switcher exists in the tenant app (the mockup's sidebar shows a static "Your workspace" badge).
- A rep sees only their own calls and feedback. Cross-rep visibility requires `company_admin`.
- Company switching and tenant creation live **only** in the super-admin portal.

---

## 5. Multi-tenancy & data isolation

- Every domain row carries a `company_id`. Every query is scoped by it. Prefer **row-level security** (e.g. Postgres RLS) so isolation is enforced at the database, not just the app layer.
- Super-admin context can cross tenants; all such access must be audit-logged.
- Each company stores **its own LLM API key** (encrypted at rest). All AI calls for that company use that key and bill to that company.
- Uploaded files and transcripts are tenant-scoped storage with per-tenant encryption keys where feasible.

---

## 6. Feature specifications

### 6.1 Live in-call HUD  *(see mockup → "On the call")*
The flagship surface. **Design principle: minimal and glanceable** — the rep reads it while actively talking to a stressed human. Spend attention budget carefully.

Components:
1. **Caller card** — name, number, and detected context (e.g. "Frustrated · 3rd call" or "Curious · new lead"), pulled from the phone/CRM integration and call history.
2. **Call-context bar** — detected **call type + journey position** (e.g. *Inbound demo · touch 1*) and a **stage stepper** for the current mode, with the current stage lit.
3. **Tone gauge** — live read of the rep's delivery (warm ↔ firm) with a one-line nudge ("a touch firm — soften").
4. **Pace gauge** — speaking rate (steady ↔ rushing) with a nudge ("slow down ~15%").
5. **Energy match** — a track showing the caller's energy vs. the rep's, with guidance to match then steer (e.g. de-escalate).
6. **"Say next" cue** — the single most important element: the lead line to say now, a short *why*, and 2–3 alternative quick-actions (mode/stage-aware: in sales discovery these become discovery questions, not pitches).
7. **Discovery tracker** — what's been captured vs. still missing. Holds the rep in discovery until the real problem is on the table (see 6.4).
8. **Just-listen state** — a toggle that visibly quiets the HUD (dims the suggestion, expands the waveform) to signal "let them finish; don't interrupt." The AI should also *enter this state automatically* when it detects the customer is venting / mid-explanation.
9. **Live score** — a running call score with a short trend note.

Latency target: a refreshed suggestion should appear within **~1–2 seconds** of the relevant speech. Gauges update continuously.

The HUD must be **modular** — gauges and panels are pluggable modules that an admin can enable/disable per role, and new module types can be added without reworking the core (mockup → Company & settings → "Modular HUD").

### 6.2 Modes: Care vs Sales
Same shell, different brain. Switching mode re-skins the HUD (care = aqua, sales = violet in the mockup) and swaps the stage machine, the cue style, the discovery logic, and the scoring rubric. A user's **default mode** is set by their admin and is what calls open in.

### 6.3 Playbooks & modes  *(see mockup → "Playbooks & modes")*
- Each mode contains multiple playbooks. Ship defaults: care → De-escalation, Guided support; sales → Physical product, Service, Software/SaaS.
- A playbook defines: stage sequence, discovery prompt bank, tone/pace targets, scoring weights, and tactical cues.
- **CRUD** — admins can add, edit, and delete playbooks; everything is customizable.
- **Auto-generation from data:** when a company uploads a file, the system analyzes it and, where appropriate, **proposes a new playbook/mode** ("Proposed from your upload"). The admin can **Accept** (push to modes), edit, or **Dismiss**. (mockup → Playbooks banner, and Company & settings → KB "new mode suggested" notice.)

### 6.4 Call-type awareness & discovery-first logic
- At call start, determine **call type** (cold / inbound / follow-up / returning) and **touch number / stage in the journey** — from the phone system metadata, CRM lookup, and prior call history.
- The approach changes accordingly (a cold call ≠ a 3rd follow-up ≠ an inbound demo).
- **Discovery is the gate.** Before suggesting any solution/pitch, the system must surface the customer's actual problem. If the problem isn't captured, the HUD stays in discovery and keeps generating probing questions ("What are you using now?", "Is that working?", "Where's it costing you?"). Only once the real pain is on the table does it move to Solution/Resolve and map the **company's product** to that specific pain. The same diagnose-first instinct applies on the care side.

### 6.5 Post-call feedback  *(see mockup → "My feedback")*
After each call, generate per-rep coaching:
- **Overall score** and verdict.
- **Breakdown** scored against the playbook rubric (care: empathy, tone, pacing, discovery/listening, resolution clarity; sales: discovery depth, objection handling, value framing, pacing, close strength).
- **Moments** — timestamped good/warn/bad events ("talked over the caller at 03:18").
- **One concrete "try next time."** Keep coaching actionable and singular, not a laundry list.
- A rep sees only their own feedback.

### 6.6 Call log / history  *(see mockup → "Call log")*
Every call is saved and rated. Each entry shows score + gap and an **AI summary** of what happened. The detail view contains:
- **AI summary** (a short paragraph).
- **Tasks & notes** — auto-extracted action items, each checkable and tagged as AI-generated.
- **Scheduled follow-up** — if the call implies a follow-up or callback, create a **calendar event** and show it as "✓ on calendar." Calls needing nothing say so.
- Anything that "came out of the call" becomes either a task, a note, or a calendar event.
- Scope: reps see their own; admins see all (and reach the same detail from reporting).

### 6.7 Tasks, notes & calendar
- Tasks and notes are first-class records linked to a call (and optionally a contact/deal).
- Calendar follow-ups integrate with the company's calendar provider (Google/Microsoft) — or, at minimum, generate an `.ics`/event payload.
- Tasks have done/undone state and an owner (the rep by default).

### 6.8 Team reporting + rep drill-down  *(see mockup → "Team reporting")* — admin only
- Team-level stat cards (calls, avg score, close rate, CSAT) and a **rep performance leaderboard**.
- **Drill-down:** clicking a rep opens their **profile** — stat cards, a scoring breakdown (their averages), a coaching-focus note, and **their full call log**. Calls in the profile cross-link to the call-log detail.
- Saved, rated call logs are stored team-wide for admins.

### 6.9 Super-admin portal  *(see mockup → "Super admin")* — platform owner only
A **separate** portal (tenants never see it). Manage all tenant companies: platform stats, a **tenant companies table** (plan, seats, usage, status), **create company**, open a company to manage everything, suspend, and billing. This is the only place companies are created or switched.

### 6.10 Company & settings  *(see mockup → "Company & settings")* — company admin
- **Knowledge base** — upload product docs, brand voice, FAQs, policies; show indexing status; surface auto-proposed modes.
- **AI key** — bring-your-own LLM API key (encrypted; rotate/revoke).
- **Phone integration** — connect a provider; see §8.
- **Appearance** — per-company theme/brand accent.
- **Plan & seats** — seat usage, add seats.
- **Team, roles & access** — add users, set role + default mode + access level.

---

## 7. The AI engine — how it works

Treat the AI as four cooperating subsystems. Companies bring their own LLM key; design provider-agnostic but optimize for the **Claude API** as the reference implementation. Verify current models, streaming, tool-use, and pricing in the official docs: https://docs.claude.com/en/api/overview (do not hardcode pricing or model strings that may change).

### 7.1 Knowledge ingestion (RAG)
- On upload: parse (PDF/docx/text), chunk, embed, and store vectors in a per-tenant index.
- At inference: retrieve the most relevant chunks for the live moment and inject them into the prompt so suggestions are grounded in the company's real product and policies.

### 7.2 Real-time suggestion pipeline (the hard part)
```
Phone audio (rep + caller)
        │
        ▼
 Streaming speech-to-text  ──►  rolling transcript + speaker labels
        │
        ▼
 Context assembler  ──►  { transcript window, mode, playbook, stage,
                            call type/touch #, captured problems,
                            retrieved KB chunks, rep profile }
        │
        ▼
 LLM (low-latency model, streaming)  ──►  { say-next line, why,
                            alt actions, stage transition, listen? }
        │
        ▼
 Live HUD  (renders within ~1–2s)
```
- Use a **fast/cheap model** for the live loop (e.g. a Haiku-class model) and stream tokens; reserve a stronger model (Sonnet/Opus-class) for post-call analysis where latency doesn't matter. Confirm current model names in the docs.
- Run the LLM call as a structured/tool-use response so the client gets typed fields (line, why, stage, listen-flag), not prose to parse.
- Debounce: regenerate the cue on meaningful turns, not every word.

### 7.3 Tone & pace analysis
- Tone and pace are largely **acoustic/prosodic** signals (speaking rate, pitch variance, energy), best computed from the audio stream / STT timing — not from the LLM. Build these as a separate analyzer feeding the gauges. The LLM can incorporate the resulting labels ("rep sounds rushed") into its nudges.

### 7.4 Post-call analysis
- Feed the full transcript + playbook rubric to a stronger model to produce: overall score, breakdown scores, timestamped moments, the single coaching tip, the summary, extracted tasks/notes, and any follow-up to schedule. Structured output.

### 7.5 Auto playbook proposal
- On new KB upload, run an analysis pass that decides whether the material warrants a new playbook (e.g. an enterprise renewal guide → a "software renewal" sales model), and drafts its stages, discovery bank, and rubric for admin approval.

**Prompt/config note:** mode + playbook + stage + call-type select a prompt template and rubric. Keep these as editable configuration (so non-engineers can tune playbooks), not buried in code.

---

## 8. Phone-system integration

Companies use many phone systems, so support a **provider-adapter pattern** with a clean internal interface (`onCallStart`, `onAudioFrame`, `onCallEnd`, `getCallMetadata`).

Recommended paths, in order:
1. **Twilio (Voice + Media Streams)** — first integration; streams live call audio over WebSocket to our STT. Best documented, fastest to MVP.
2. **SIPREC / SIP media forking** — for PBX/contact-center systems that can fork media to us.
3. **Provider connectors** — RingCentral, Aircall, Genesys, etc., via their APIs/webhooks for metadata + recording/stream access.
4. **Browser/WebRTC softphone** — for teams that take calls in-browser; we capture audio directly.

All providers normalize into the same internal call object. Start with Twilio for v1; add adapters later. Capture, at minimum: caller number, direction (inbound/outbound), timestamps, and (where available) CRM contact id.

---

## 9. Data model (initial)

Entities (all tenant rows carry `company_id`):

- **companies** — id, name, plan, status, theme, created_at.
- **users** — id, company_id, name, email, role, default_mode, access_level, status.
- **api_keys** — id, company_id, provider, encrypted_key, status.
- **integrations** — id, company_id, type (twilio/ringcentral/…), config, status.
- **kb_documents** — id, company_id, filename, type, status (indexed/analyzed), storage_ref.
- **kb_chunks** — id, document_id, company_id, text, embedding.
- **modes** — fixed enum (care/sales) or table if you want custom top-level modes.
- **playbooks** — id, company_id, mode, name, description, stages (json), discovery_bank (json), rubric_weights (json), source ("default"/"ai-proposed"/"custom"), status.
- **playbook_proposals** — id, company_id, source_document_id, draft (json), status (pending/accepted/dismissed).
- **calls** — id, company_id, user_id (rep), contact_name, contact_number, mode, playbook_id, call_type, touch_number, direction, started_at, duration, recording_ref, transcript_ref, overall_score, gap, summary.
- **call_scores** — id, call_id, dimension, value (the breakdown).
- **call_moments** — id, call_id, timestamp, severity (good/warn/bad), label, detail.
- **tasks** — id, company_id, call_id, owner_user_id, text, kind (follow-up/note), source ("ai"/"manual"), done.
- **calendar_events** — id, company_id, call_id, title, start, end, status, external_ref.
- **suggestions_log** *(optional, for QA/improvement)* — id, call_id, timestamp, stage, suggested_line, used (bool).
- **audit_log** — id, actor_user_id, company_id (nullable for platform actions), action, target, at.

---

## 10. API surface (representative)

REST/JSON (or tRPC/GraphQL — implementer's choice). All endpoints tenant-scoped and role-checked.

- `POST /auth/login`, `POST /auth/logout`, `GET /me`
- `GET/POST/PATCH/DELETE /companies` *(super-admin)*
- `GET/POST/PATCH/DELETE /users`
- `GET/PUT /settings/api-key`, `GET/POST/DELETE /settings/integrations`
- `POST /kb/documents` (upload), `GET /kb/documents`, `DELETE /kb/documents/:id`
- `GET /playbooks`, `POST /playbooks`, `PATCH /playbooks/:id`, `DELETE /playbooks/:id`
- `GET /playbook-proposals`, `POST /playbook-proposals/:id/accept|dismiss`
- **Live (WebSocket):** `WS /calls/live` — bidirectional: audio/transcript frames up, suggestions/gauge updates down.
- `GET /calls` (scoped), `GET /calls/:id` (detail: summary, scores, moments, tasks, follow-up)
- `GET /tasks`, `PATCH /tasks/:id`
- `GET /reporting/team` *(admin)*, `GET /reporting/reps/:id` *(admin)*
- Webhooks: `POST /webhooks/telephony/:provider`

---

## 11. Recommended tech stack

Implementer may substitute, but this is a sane, fast default:

- **Frontend:** React + TypeScript + Vite, Tailwind. Rebuild the screens from `callaid_ui.html` (which already encodes the design tokens, palette, typography — Space Grotesk / Inter / JetBrains Mono — and all four+ screens). Real-time HUD via WebSocket.
- **Backend:** Node/TypeScript (NestJS or Fastify) or Python (FastAPI). WebSocket gateway for the live loop.
- **DB:** Postgres + **row-level security** for tenant isolation; pgvector (or a managed vector DB) for KB embeddings.
- **Realtime/queue:** Redis for pub/sub + a job queue for post-call analysis and KB indexing.
- **Storage:** S3-compatible for recordings/transcripts/docs (per-tenant prefixes, encrypted).
- **Telephony:** Twilio Voice + Media Streams (v1).
- **STT:** a streaming speech-to-text provider with low latency and speaker diarization.
- **LLM:** Anthropic Claude API (per-tenant key). Fast model for live, stronger model for analysis — confirm current models in docs.
- **Auth:** email + SSO later; JWT/session; strict RBAC middleware.

---

## 12. Security, privacy & compliance  *(do not skip)*

- **Call recording consent:** laws vary by region (one-party vs all-party consent, EU rules, etc.). The platform must support per-company / per-region consent configuration, optional automated consent announcements, and the ability to disable recording while still assisting. **Get legal review before launch in each market.** This is a product requirement, not an afterthought.
- **Tenant isolation:** enforce at the DB (RLS), encrypt KB/transcripts/recordings at rest, isolate per-tenant API keys.
- **PII:** transcripts and recordings are sensitive. Define retention, deletion, and export per tenant. Support "delete this call/customer's data."
- **Secrets:** company LLM keys and integration creds encrypted (KMS/secrets manager), never logged.
- **Audit:** log all cross-tenant (super-admin) and destructive actions.
- **AI guardrails:** suggestions must come only from the company's KB + transcript; never invent product facts or policies. Show a confidence/"verify" affordance where appropriate.

---

## 13. Non-functional requirements

- Live suggestion latency: ~1–2s p95 from speech to rendered cue.
- HUD must stay readable and uncluttered under load; never block on a slow LLM call (degrade gracefully — keep gauges live even if a cue is late).
- Scale horizontally per concurrent call (WebSocket + STT + LLM streams are the cost/latency drivers).
- Accessibility: keyboard focus, reduced-motion support (already respected in the mockup), legible contrast.
- Mobile-responsive (mockup already collapses to a bottom tab bar).

---

## 14. Build roadmap (phased)

**Phase 0 — Foundations**
Auth, multi-tenant data model with RLS, company/user CRUD, super-admin create-company, RBAC. Port the mockup to a real React app.

**Phase 1 — Knowledge + post-call (no live yet)**
KB upload + indexing (RAG). Ingest a recording/transcript (manual upload) → produce summary, scores, moments, coaching, tasks, follow-up. Call log + My feedback screens working end-to-end. This proves the AI value with the least moving parts.

**Phase 2 — Live HUD**
Twilio Media Streams → streaming STT → context assembler → live cue + tone/pace gauges + stage stepper + discovery tracker + just-listen. This is the flagship; budget the most time here.

**Phase 3 — Modes, playbooks & auto-proposal**
Care vs sales fully differentiated. Playbook CRUD. Auto-propose playbooks from uploads. Call-type/journey detection.

**Phase 4 — Reporting & admin depth**
Team reporting + rep drill-down. Calendar integration. Themes. Seats/billing. Additional phone adapters.

**Phase 5 — Launch hardening**
Consent/recording compliance per market, security review, load testing, observability, pilot with 1–2 design-partner companies, then GA.

---

## 15. Launch checklist

- [ ] Legal sign-off on call-recording/consent for each launch region
- [ ] Tenant isolation verified (pen-test the RLS boundary)
- [ ] Secrets management for per-tenant keys verified
- [ ] Latency p95 within target under realistic concurrency
- [ ] Graceful degradation when STT/LLM is slow or a tenant key is invalid
- [ ] Data retention/deletion + export flows working
- [ ] Billing + seat enforcement
- [ ] Observability: per-call tracing, error alerting, cost dashboards (LLM/STT spend per tenant)
- [ ] Design-partner pilot feedback incorporated
- [ ] Support/docs for company admins (KB upload, playbooks, integrations)

---

## 16. Open decisions (resolve early)

1. **STT provider** — which streaming STT (latency, diarization quality, cost, language coverage)?
2. **Live model** — confirm the fastest suitable Claude model and whether tool-use streaming meets the latency budget.
3. **Recording** — do we always record, or assist-only by default with recording opt-in per tenant?
4. **CRM linkage** — v1 contact context from phone metadata only, or integrate a CRM (e.g. HubSpot/Salesforce) for richer caller history?
5. **Pricing model** — per seat, per call minute, or per-tenant tiers (affects seat/billing logic).
6. **Calendar** — native Google/Microsoft integration in v1, or `.ics` export first?

---

## 17. Design reference

`callaid_ui.html` is the visual spec. It contains, working and clickable:
- **On the call** — live HUD with mode toggle, call-context bar + stage stepper, tone & pace gauges, energy match, say-next cue, discovery tracker, just-listen state, live score.
- **My feedback** — single-call coaching.
- **Call log** — history list + detail (summary, auto tasks, calendar follow-up).
- **Playbooks & modes** — default playbooks + AI-proposed mode (accept/dismiss) + CRUD affordances.
- **Team reporting** — team stats, leaderboard, and rep drill-down profile.
- **Company & settings** — KB upload + auto-proposal, BYO API key, phone integration, themes, seats, team & roles/access.
- **Super admin** — platform stats + tenant companies table + add company.

Design tokens (palette, the aqua-care / violet-sales mode tinting, type scale, gauges) are all in that file's `<style>` block — reuse them verbatim so the rebuilt app matches.

---

*End of specification. Build Phase 1 before Phase 2; prove the AI loop on recordings before going real-time.*
