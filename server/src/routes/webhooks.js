// Telephony webhooks (spec §8/§10). Provider-adapter pattern: every provider
// normalizes into the same internal call object (onCallStart / getCallMetadata).
// This is the metadata ingress; live audio for Twilio would arrive over the Media
// Streams WebSocket and be forwarded to STT, then into the live gateway.
//
// This endpoint performs unauthenticated-by-nature ingress, so every request must
// be cryptographically verified before it touches the database:
//   - Twilio: X-Twilio-Signature = base64(HMAC-SHA1(authToken, url + sorted POST params))
//   - Other providers: a shared secret in the X-Webhook-Secret header
// Unverified requests are rejected (403) in production. Also rate-limited.
import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '../db.js';
import { id, now } from '../util.js';
import { rateLimit } from '../middleware/rateLimit.js';

export const router = Router();

const isProd = process.env.NODE_ENV === 'production';
const webhookLimiter = rateLimit({ windowMs: 60_000, max: 120, bucket: 'webhook' });

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// Twilio request validation: HMAC-SHA1 over the full URL + params sorted by key,
// keyed by the account auth token. See Twilio "Validating requests".
function twilioSignatureValid(req) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return false;
  const signature = req.headers['x-twilio-signature'];
  if (!signature) return false;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const url = `${proto}://${req.headers.host}${req.originalUrl}`;
  const body = req.body || {};
  let data = url;
  for (const key of Object.keys(body).sort()) data += key + body[key];
  const expected = createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
  return safeEqual(signature, expected);
}

// Generic providers: shared secret header (constant-time compared).
function sharedSecretValid(req) {
  const secret = process.env.CALLAID_WEBHOOK_SECRET;
  if (!secret) return false;
  return safeEqual(req.headers['x-webhook-secret'] || '', secret);
}

function verify(provider, req) {
  if (provider === 'twilio') return twilioSignatureValid(req);
  return sharedSecretValid(req);
}

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

router.post('/webhooks/telephony/:provider', webhookLimiter, (req, res) => {
  const provider = req.params.provider;

  if (!verify(provider, req)) {
    // In production a webhook with no valid signature/secret is rejected. In dev,
    // when no secret is configured, allow it through so local testing works.
    const noSecretConfigured = !process.env.TWILIO_AUTH_TOKEN && !process.env.CALLAID_WEBHOOK_SECRET;
    if (isProd || !noSecretConfigured) return res.status(403).json({ error: 'invalid_signature' });
    console.warn(`[webhook] accepting unverified ${provider} webhook — no secret configured (dev only)`);
  }

  const meta = normalize(provider, req.body || {});
  // Record the inbound event for observability; a real adapter would resolve the
  // tenant from the provider config and open a live session.
  db.prepare('INSERT INTO audit_log (id,actor_user_id,company_id,action,target,detail,at) VALUES (?,?,?,?,?,?,?)')
    .run(id('aud'), null, null, 'telephony_webhook', provider, JSON.stringify(meta), now());
  res.json({ ok: true, normalized: meta });
});
