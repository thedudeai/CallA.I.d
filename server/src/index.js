// CallA.I.d backend entry. Express REST API + live WebSocket HUD gateway.
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './db.js'; // runs migrations on import

import { router as authRoutes } from './routes/auth.js';
import { router as adminRoutes } from './routes/admin.js';
import { router as settingsRoutes } from './routes/settings.js';
import { router as playbookRoutes } from './routes/playbooks.js';
import { router as callRoutes } from './routes/calls.js';
import { router as reportingRoutes } from './routes/reporting.js';
import { router as webhookRoutes } from './routes/webhooks.js';
import { attachLiveGateway } from './live/gateway.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'callaid', time: new Date().toISOString() }));

// All API routes under /api.
const api = express.Router();
api.use(authRoutes);
api.use(adminRoutes);
api.use(settingsRoutes);
api.use(playbookRoutes);
api.use(callRoutes);
api.use(reportingRoutes);
api.use(webhookRoutes);
app.use('/api', api);

// Serve the built frontend in production (single-origin deploy).
const webDist = join(__dirname, '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api|calls\/live).*/, (req, res) => res.sendFile(join(webDist, 'index.html')));
}

// Centralized error handler.
app.use((err, req, res, next) => {
  console.error('[error]', err?.message || err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'server_error' });
});

const server = http.createServer(app);
attachLiveGateway(server);

server.listen(PORT, () => {
  console.log(`CallA.I.d API on http://localhost:${PORT}  (WS: /calls/live)`);
});
