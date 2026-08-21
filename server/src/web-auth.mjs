import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_COOKIE_NAME = 'phoneweave_web_session';
const DEFAULT_TTL_SECONDS = 12 * 60 * 60;

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookies(req) {
  const result = new Map();
  for (const part of String(req.headers.cookie || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) result.set(name, value);
  }
  return result;
}

function secureRequest(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return forwarded === 'https' || Boolean(req.socket?.encrypted);
}

export function createWebAuth({
  webToken,
  cookieName = DEFAULT_COOKIE_NAME,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  now = () => Date.now(),
} = {}) {
  if (!webToken) throw new Error('WEB_TOKEN is required');

  const sign = payload => createHmac('sha256', webToken).update(`phoneweave-web-v1:${payload}`).digest('base64url');

  function passwordMatches(candidate) {
    return safeEqual(candidate || '', webToken);
  }

  function createSession() {
    const expiresAt = now() + Number(ttlSeconds) * 1000;
    const payload = expiresAt.toString(36);
    return `${payload}.${sign(payload)}`;
  }

  function sessionAuthorized(req) {
    const value = cookies(req).get(cookieName) || '';
    const separator = value.indexOf('.');
    if (separator < 1) return false;
    const payload = value.slice(0, separator);
    const signature = value.slice(separator + 1);
    const expiresAt = Number.parseInt(payload, 36);
    return Number.isFinite(expiresAt) && expiresAt > now() && safeEqual(signature, sign(payload));
  }

  function cookie(value, maxAge) {
    return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
  }

  function sessionCookie(req) {
    return `${cookie(createSession(), Number(ttlSeconds))}${secureRequest(req) ? '; Secure' : ''}`;
  }

  function clearCookie(req) {
    return `${cookie('', 0)}${secureRequest(req) ? '; Secure' : ''}`;
  }

  return { passwordMatches, sessionAuthorized, sessionCookie, clearCookie };
}
