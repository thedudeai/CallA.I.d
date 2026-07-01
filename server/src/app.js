// The Express app, importable on its own so it can run either as a long-lived
// server (index.js, with the WebSocket gateway attached) or as a serverless
// function (../../api/index.js on Vercel). No listen()/WebSocket here.
import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EPHEMERAL_DB } from './db.js';
import { seedIfEmpty } from './seed.js';
import { rateLimit } from './middleware/rateLimit.js';

import { router as authRoutes } from './routes/auth.js';
import { router as adminRoutes } from './routes/admin.js';
import { router as settingsRoutes } from './routes/settings.js';
import { router as playbookRoutes } from './routes/playbooks.js';
import { router as callRoutes } from './routes/calls.js';
import { router as reportingRoutes } from './routes/reporting.js';
import { router as webhookRoutes } from './routes/webhooks.js';
import { router as zohoRoutes } from './routes/zoho.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// On an ephemeral serverless DB, seed on cold start so the instance has data.
if (EPHEMERAL_DB) { try { seedIfEmpty(); } catch (e) { console.error('seed-on-cold-start failed', e?.message); } }

export const app = express();

// Behind a load balancer / platform proxy we need the real client IP for rate
// limiting and logging. Configurable so it isn't blindly trusted everywhere.
app.set('trust proxy', process.env.CALLAID_TRUST_PROXY || 'loopback');

// CORS: allow only the configured SPA origin(s). CALLAID_CORS_ORIGINS is a
// comma-separated allowlist; if unset we fall back to reflecting no cross-origin
// requests (same-origin only), which is the safe default for the single-origin
// container deploy. Set it to your SPA origin(s) when the frontend is served
// from a different host (e.g. a CDN).
const corsOrigins = (process.env.CALLAID_CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: corsOrigins.length ? corsOrigins : false,
  credentials: false,
}));

// Baseline security headers (helmet-equivalent, no extra dependency).
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(express.json({ limit: '2mb' }));

// Global loose limiter as a backstop; auth and AI routes add stricter buckets.
app.use('/api', rateLimit({ windowMs: 60_000, max: 300, bucket: 'global' }));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'callaid', time: new Date().toISOString() }));

const api = express.Router();
// Public / partially-public routers must be mounted BEFORE the routers that apply
// a pathless `router.use(authRequired)` (admin/settings/playbooks/calls/reporting).
// A pathless auth middleware in a sub-router mounted at '/' intercepts every
// request that reaches it, so anything mounted after would 401 even on its public
// routes — which previously made the Zoho OAuth callback and telephony webhook
// unreachable. Auth-required routes inside these routers still enforce auth
// per-route, so ordering them first is safe.
api.use(authRoutes);      // login is public; logout/me are per-route authed
api.use(webhookRoutes);   // telephony webhook (signature-verified, no session)
api.use(zohoRoutes);      // /zoho/callback is public; the rest are per-route authed
api.use(adminRoutes);
api.use(settingsRoutes);
api.use(playbookRoutes);
api.use(callRoutes);
api.use(reportingRoutes);
app.use('/api', api);

// Serve the built frontend when present (single-origin local/container deploy).
// On Vercel the static SPA is served by the CDN, so this branch is inert there.
const webDist = join(__dirname, '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api|calls\/live).*/, (req, res) => res.sendFile(join(webDist, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error('[error]', err?.message || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'server_error' });
});
