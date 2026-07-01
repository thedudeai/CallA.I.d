// Live in-call HUD loop (spec §6.1 / §7.2). A WebSocket carries transcript/turn
// frames up and streams say-next cues + gauge updates + stage + just-listen +
// live score down, targeting the ~1-2s refresh budget. In production the up-frames
// come from Twilio Media Streams → streaming STT; here the browser call-simulator
// (or a telephony adapter) feeds turns in. On end, the full transcript is run
// through post-call analysis and persisted as a completed call.
import { WebSocketServer } from 'ws';
import jwt from 'jsonwebtoken';
import { db } from '../db.js';
import { hydratePlaybook, liveSuggest, analyzeCall } from '../ai/index.js';
import { syncOnComplete } from '../integrations/zoho/index.js';
import { persistAnalyzedCall } from '../routes/calls.js';
import { id, now } from '../util.js';
import { JWT_SECRET } from '../secrets.js';

function authFromUrl(reqUrl) {
  try {
    const token = new URL(reqUrl, 'http://x').searchParams.get('token');
    if (!token) return null;
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND status = ?').get(payload.uid, 'active');
    return user || null;
  } catch { return null; }
}

export function attachLiveGateway(server) {
  const wss = new WebSocketServer({ server, path: '/calls/live' });

  wss.on('connection', (ws, req) => {
    const user = authFromUrl(req.url);
    if (!user || !user.company_id) { ws.close(4001, 'unauthorized'); return; }

    // Per-connection live session state.
    const session = {
      mode: user.default_mode || 'care',
      playbook: null,
      transcript: [],
      contact_name: 'Caller', contact_number: null,
      call_type: null, touch_number: 1, direction: 'inbound',
      started: Date.now(),
      pending: null, // debounce timer
    };

    const send = (obj) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); };

    async function regenerate() {
      try {
        const g = await liveSuggest(user.company_id, {
          transcript: session.transcript, mode: session.mode, playbook: session.playbook,
          callType: session.call_type, touchNumber: session.touch_number,
        });
        // QA log of what we suggested (spec §9 suggestions_log).
        db.prepare('INSERT INTO suggestions_log (id,company_id,ts,stage,suggested_line,used) VALUES (?,?,?,?,?,?)')
          .run(id('sg'), user.company_id, now(), g.stage?.name || null, g.cue?.line || null, 0);
        send({ type: 'guidance', ...g, elapsed: Math.round((Date.now() - session.started) / 1000) });
      } catch (e) {
        send({ type: 'error', message: 'guidance_failed' });
      }
    }

    // Debounce: regenerate on meaningful turns, not every keystroke (spec §7.2).
    function scheduleRegen(delay = 350) {
      if (session.pending) clearTimeout(session.pending);
      session.pending = setTimeout(regenerate, delay);
    }

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'start') {
        session.mode = msg.mode || session.mode;
        const pbRow = msg.playbook_id ? db.prepare('SELECT * FROM playbooks WHERE id = ? AND company_id = ?').get(msg.playbook_id, user.company_id) : null;
        session.playbook = hydratePlaybook(pbRow);
        session.contact_name = msg.contact_name || session.contact_name;
        session.contact_number = msg.contact_number || null;
        session.call_type = msg.call_type || (session.mode === 'sales' ? 'inbound' : 'returning');
        session.touch_number = msg.touch_number || 1;
        session.direction = msg.direction || 'inbound';
        session.transcript = [];
        session.started = Date.now();
        send({ type: 'ready', mode: session.mode, contact_name: session.contact_name, call_type: session.call_type, touch_number: session.touch_number });
        scheduleRegen(50);
      } else if (msg.type === 'turn') {
        if (!msg.text) return;
        session.transcript.push({ speaker: msg.speaker === 'rep' ? 'rep' : 'caller', text: String(msg.text).slice(0, 1000), t: fmt((Date.now() - session.started) / 1000), interrupt: !!msg.interrupt });
        scheduleRegen();
      } else if (msg.type === 'listen') {
        send({ type: 'listen', on: !!msg.on });
      } else if (msg.type === 'mode') {
        session.mode = msg.mode === 'sales' ? 'sales' : 'care';
        scheduleRegen(50);
      } else if (msg.type === 'end') {
        await finalize();
      }
    });

    async function finalize() {
      if (!session.transcript.length) { send({ type: 'analysis', empty: true }); return; }
      try {
        const durationSec = Math.round((Date.now() - session.started) / 1000);
        const result = await analyzeCall(user.company_id, {
          transcript: session.transcript, mode: session.mode, playbook: session.playbook,
          contactName: session.contact_name, durationSec,
        });
        const cid = id('call');
        // Same atomic persistence path as the HTTP /calls/analyze route.
        persistAnalyzedCall({
          cid, companyId: user.company_id, userId: user.id, contactName: session.contact_name,
          contactNumber: session.contact_number, mode: session.mode,
          playbookId: session.playbook?.id || null, callType: session.call_type,
          touchNumber: session.touch_number, direction: session.direction,
          startedAt: new Date(session.started).toISOString(), duration: durationSec,
          transcript: session.transcript, result,
        });
        await syncOnComplete(user.company_id, cid); // mirror into Zoho if connected (idempotent)
        send({ type: 'analysis', call_id: cid, engine: result.engine });
      } catch (e) {
        console.error('[gateway] finalize failed:', e?.message);
        send({ type: 'error', message: 'analysis_failed' });
      }
    }

    ws.on('close', () => { if (session.pending) clearTimeout(session.pending); });
  });

  return wss;
}

function fmt(s) { const m = Math.floor(s / 60); const r = Math.floor(s % 60); return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`; }
