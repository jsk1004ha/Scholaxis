import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const derived = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash: derived, digest: `${salt}:${derived}` };
}

export function verifyPassword(password, digest = '') {
  const [salt, expected] = String(digest).split(':');
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64).toString('hex');
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

export function createSessionToken() {
  return randomBytes(32).toString('hex');
}

export function hashSessionToken(token) {
  return sha256(token);
}

export function parseCookies(header = '') {
  const cookies = {};
  for (const chunk of String(header).split(';')) {
    const [name, ...rest] = chunk.trim().split('=');
    if (!name) continue;
    cookies[name] = decodeURIComponent(rest.join('='));
  }
  return cookies;
}

export function buildSessionCookie(token, options = {}) {
  const maxAge = options.maxAge ?? 60 * 60 * 24 * 30;
  const parts = [
    `scholaxis_session=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearedSessionCookie() {
  return 'scholaxis_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}
