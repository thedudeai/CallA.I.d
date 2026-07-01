// Minimal in-memory fixed-window rate limiter. No external dependency: the
// production deployment target is a single stateful Node process (container),
// so a per-process limiter is sufficient. If/when the app scales horizontally,
// swap this for a Redis-backed limiter (same middleware signature).
//
// Keyed by client IP + an optional per-route bucket so the login limiter and the
// AI-cost limiter don't share a counter.

const buckets = new Map(); // key -> { count, resetAt }

function clientIp(req) {
  // Trust the first hop of X-Forwarded-For when behind a known proxy; fall back
  // to the socket address. (Set app.set('trust proxy', ...) at the app level.)
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function rateLimit({ windowMs = 60_000, max = 60, bucket = 'default' } = {}) {
  return (req, res, next) => {
    const key = `${bucket}:${clientIp(req)}`;
    const nowMs = Date.now();
    let entry = buckets.get(key);
    if (!entry || entry.resetAt <= nowMs) {
      entry = { count: 0, resetAt: nowMs + windowMs };
      buckets.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - nowMs) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'rate_limited', retry_after: retryAfter });
    }
    next();
  };
}

// Opportunistic cleanup so the Map doesn't grow unbounded for one-off IPs.
setInterval(() => {
  const nowMs = Date.now();
  for (const [key, entry] of buckets) if (entry.resetAt <= nowMs) buckets.delete(key);
}, 5 * 60_000).unref?.();
