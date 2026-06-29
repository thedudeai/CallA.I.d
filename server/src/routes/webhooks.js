// Telephony webhooks (spec §8/§10). Provider-adapter pattern: every provider
// normalizes into the same internal call object (onCallStart / getCallMetadata).
// This is the metadata ingress; live audio for Twilio would arrive over the Media
// Streams WebSocket and be forwarded to STT, then into the live gateway.
import { Router } from 'express';
import { db } from '../db.js';
import { id, now } from '../util.js';

export const router = Router();

// Normalize a raw provider payload into our internal call-context shape.
function normalize(provider, body) {
  switch (provider) {
    case 'twilio':
      return { number: body.From || body.from, direction: body.Direction === 'outbound-api' ? 'outbound' : 'inbound', external_ref: body.CallSid };
    case 'ringcentral':
      return { number: body?.body?.parties?.[0]?.from?.phoneNumber, direction: body?.body?.parties?.[0]?.direction?.toLowerCase() || 'inbound', external_ref: body?.body?.telephonySessionId };
    default:
      return { number: body.from || body.number, direction: body.direction || 'inbound', external_ref: body.id || null };
  }
}

router.post('/webhooks/telephony/:provider', (req, res) => {
  const provider = req.params.provider;
  const meta = normalize(provider, req.body || {});
  // Record the inbound event for observability; a real adapter would resolve the
  // tenant from the provider config and open a live session.
  db.prepare('INSERT INTO audit_log (id,actor_user_id,company_id,action,target,detail,at) VALUES (?,?,?,?,?,?,?)')
    .run(id('aud'), null, null, 'telephony_webhook', provider, JSON.stringify(meta), now());
  res.json({ ok: true, normalized: meta });
});
