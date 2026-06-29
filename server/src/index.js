// Long-lived server entry: the Express app + the live WebSocket HUD gateway.
// (Serverless deploys use ../../api/index.js, which imports the same app but
// cannot hold a WebSocket open — the client falls back to HTTP there.)
import http from 'node:http';
import { app } from './app.js';
import { attachLiveGateway } from './live/gateway.js';

const PORT = process.env.PORT || 4000;
const server = http.createServer(app);
attachLiveGateway(server);

server.listen(PORT, () => {
  console.log(`CallA.I.d API on http://localhost:${PORT}  (WS: /calls/live)`);
});
