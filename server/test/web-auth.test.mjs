import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebAuth } from '../src/web-auth.mjs';

function request(cookie = '', forwardedProto = '') {
  return { headers: { cookie, 'x-forwarded-proto': forwardedProto }, socket: {} };
}

test('requires WEB_TOKEN when creating web authentication', () => {
  assert.throws(() => createWebAuth({ webToken: '' }), /WEB_TOKEN is required/);
});

test('creates an HttpOnly session without exposing the web token', () => {
  const auth = createWebAuth({ webToken: 'very-secret', now: () => 1_000, ttlSeconds: 60 });
  const header = auth.sessionCookie(request('', 'https'));
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Secure/);
  assert.doesNotMatch(header, /very-secret/);
  assert.equal(auth.sessionAuthorized(request(header.split(';')[0])), true);
});

test('rejects tampered and expired sessions', () => {
  let now = 1_000;
  const auth = createWebAuth({ webToken: 'very-secret', now: () => now, ttlSeconds: 1 });
  const pair = auth.sessionCookie(request()).split(';')[0];
  assert.equal(auth.sessionAuthorized(request(`${pair}x`)), false);
  now = 2_001;
  assert.equal(auth.sessionAuthorized(request(pair)), false);
});
