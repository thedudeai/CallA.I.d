// Vercel serverless entry — PREVIEW/DEMO ONLY, not a production deployment.
//
// Routes every /api/* request (via the rewrite in vercel.json) into the same
// Express app used by the long-lived server. On Vercel the app seeds an ephemeral
// /tmp SQLite DB on cold start, so ALL tenant writes are lost on the next cold
// start / different instance, and the live HUD falls back to the
// /api/calls/live/suggest HTTP path (serverless can't hold a WebSocket). For real,
// stateful use, deploy the container image (see README → Deploy). This entry
// exists purely to spin up a throwaway click-through preview.
import { app } from '../server/src/app.js';

export default function handler(req, res) {
  return app(req, res);
}
