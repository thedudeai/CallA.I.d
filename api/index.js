// Vercel serverless entry. Routes every /api/* request (via the rewrite in
// vercel.json) into the same Express app used by the long-lived server. The app
// seeds an ephemeral /tmp SQLite DB on cold start; the live HUD uses the
// /api/calls/live/suggest HTTP path here since serverless can't hold a WebSocket.
import { app } from '../server/src/app.js';

export default function handler(req, res) {
  return app(req, res);
}
