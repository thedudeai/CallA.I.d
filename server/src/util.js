// Small shared helpers: ids, time, reversible key obfuscation, JSON safety.
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'node:crypto';

export function id(prefix = '') {
  return (prefix ? prefix + '_' : '') + randomBytes(9).toString('hex');
}

export function now() {
  return new Date().toISOString();
}

export function json(v, fallback) {
  try { return JSON.parse(v); } catch { return fallback; }
}

// Reversible obfuscation for stored tenant API keys. In production this is a
// KMS/secrets-manager envelope; here we use AES-256-GCM with a server secret so
// keys are never stored in plaintext and never logged.
const SECRET = process.env.CALLAID_SECRET || 'callaid-dev-secret-change-me';
const KEYBUF = scryptSync(SECRET, 'callaid-key-salt', 32);

export function encrypt(plain) {
  if (!plain) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEYBUF, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
}

export function decrypt(blob) {
  if (!blob) return '';
  try {
    const [ivh, tagh, ench] = blob.split(':');
    const decipher = createDecipheriv('aes-256-gcm', KEYBUF, Buffer.from(ivh, 'hex'));
    decipher.setAuthTag(Buffer.from(tagh, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(ench, 'hex')), decipher.final()]).toString('utf8');
  } catch { return ''; }
}

export function last4(s) {
  return s ? s.slice(-4) : '';
}
