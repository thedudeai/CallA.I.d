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

import { router as authRoutes } from './routes/auth.js';
import { router as adminRoutes } from './routes/admin.js';
import { router as settingsRoutes } from './routes/settings.js';
import { router as playbookRoutes } from './routes/playbooks.js';
import { router as callRoutes } from './routes/calls.js';
import { router as reportingRoutes } from './routes/reporting.js';
import { router as webhookRoutes } from './routes/webhooks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// On an ephemeral serverless DB, seed on cold start so the instance has data.
if (EPHEMERAL_DB) { try { seedIfEmpty(); } catch (e) { console.error('seed-on-cold-start failed', e?.message); } }

export const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'callaid', time: new Date().toISOString() }));

const api = express.Router();
api.use(authRoutes);
api.use(adminRoutes);
api.use(settingsRoutes);
api.use(playbookRoutes);
api.use(callRoutes);
api.use(reportingRoutes);
api.use(webhookRoutes);
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
