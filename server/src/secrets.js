// Centralized secret resolution with fail-fast in production.
//
// The JWT signing secret and the at-rest encryption key are the two secrets that,
// if left at a shared/known value, allow full auth bypass (forged super_admin
// tokens) and offline decryption of every tenant's stored provider keys and OAuth
// tokens. They MUST be provided via env in any non-development environment. There
// are deliberately NO hardcoded production fallbacks: the process refuses to start
// rather than boot with a guessable secret. In development we allow a clearly
// marked insecure default so the app can run locally, and warn loudly.
const isProd = process.env.NODE_ENV === 'production';

function required(name) {
  const val = process.env[name];
  if (val) return val;
  if (isProd) {
    throw new Error(
      `${name} is required in production. Refusing to start with an insecure default. ` +
      `Generate a strong random value, e.g.  openssl rand -hex 32`
    );
  }
  console.warn(
    `[secrets] ${name} is not set — using an INSECURE development default. ` +
    `Set ${name} before any non-development deploy.`
  );
  // Dev-only defaults, intentionally different from any value ever shipped in the
  // repo so tokens/ciphertext produced under them are not portable.
  return `dev-insecure-${name}-do-not-use-in-prod`;
}

export const JWT_SECRET = required('CALLAID_JWT_SECRET');
export const APP_SECRET = required('CALLAID_SECRET');
