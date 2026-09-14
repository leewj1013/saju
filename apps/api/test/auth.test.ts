// Google 로그인: 시작 → 콜백 → 세션 → /v1/me → 로그아웃, 실패 · 위조 · 열린 리디렉션 방어
// Google 토큰 엔드포인트는 가짜 fetch로 대체한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { buildServer } from '../src/server.ts';
import { openDb } from '../src/db.ts';
import { loadRuleSet } from '../src/rules/authoring.ts';

const { ruleSet } = loadRuleSet(path.resolve(import.meta.dirname, '../content'), 'test');
const NOW = Date.UTC(2026, 8, 13, 3);
const CLIENT_ID = 'test-client.apps.googleusercontent.com';

const idToken = (claims: object) => ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
const validClaims = (nonce: string) => ({ iss: 'https://accounts.google.com', aud: CLIENT_ID, sub: 'google-sub-1', exp: NOW / 1000 + 3600, nonce });
const cookiePair = (res: { headers: Record<string, unknown> }, name: string) =>
  [res.headers['set-cookie'] ?? []].flat().map(String).find(c => c.startsWith(`${name}=`) && !c.startsWith(`${name}=;`))?.split(';')[0];

function setup() {
  const db = openDb(':memory:');
  const google = { nonce: '', claims: validClaims, sentBody: null as URLSearchParams | null };
  const app = buildServer({
    ruleSet, db, allowOrigin: 'http://localhost:8081', now: () => NOW,
    google: {
      clientId: CLIENT_ID, clientSecret: 'test-secret', cookieSecret: 'x'.repeat(32), publicUrl: 'http://localhost:3000/',
      fetch: (async (_url: string, init: RequestInit) => {
        google.sentBody = new URLSearchParams(String(init.body));
        return Response.json({ id_token: idToken(google.claims(google.nonce)) });
      }) as typeof fetch,
    },
  });

  const login = async (returnTo = '/result?from=submit', tweak: { state?: string; cookie?: string } = {}) => {
    const start = await app.inject({ url: `/v1/auth/google/start?returnTo=${encodeURIComponent(returnTo)}` });
    const authorize = new URL(String(start.headers.location));
    google.nonce = authorize.searchParams.get('nonce')!;
    const callback = await app.inject({
      url: `/v1/auth/google/callback?code=auth-code&state=${tweak.state ?? authorize.searchParams.get('state')}`,
      headers: { cookie: tweak.cookie ?? cookiePair(start, 'saju_oauth')! },
    });
    return { start, authorize, callback, session: cookiePair(callback, 'saju_session') };
  };
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return { app, db, google, login, count };
}

test('Google 로그인: 시작 → 콜백 → 세션 → /v1/me → 같은 계정 재로그인 → 로그아웃', async () => {
  const { app, db, google, login, count } = setup();
  const { start, authorize, callback, session } = await login();

  assert.equal(start.statusCode, 302);
  assert.equal(authorize.origin + authorize.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(authorize.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(authorize.searchParams.get('redirect_uri'), 'http://localhost:3000/v1/auth/google/callback');
  assert.equal(authorize.searchParams.get('scope'), 'openid');
  assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');

  assert.equal(callback.statusCode, 302);
  assert.equal(callback.headers.location, 'http://localhost:8081/result?from=submit');
  // PKCE: 토큰 교환 때 보낸 verifier의 해시가 처음 보낸 challenge와 같다
  const verifier = google.sentBody!.get('code_verifier')!;
  assert.equal(crypto.createHash('sha256').update(verifier).digest('base64url'), authorize.searchParams.get('code_challenge'));
  assert.equal(google.sentBody!.get('redirect_uri'), 'http://localhost:3000/v1/auth/google/callback');
  assert.match([callback.headers['set-cookie']].flat().join('\n'), /saju_session=[^;]+;.*HttpOnly.*SameSite=Lax/i);

  const token = session!.split('=')[1];
  assert.notEqual((db.prepare('SELECT token_hash FROM auth_session').get() as { token_hash: string }).token_hash, token); // 원문 미저장

  const me = await app.inject({ url: '/v1/me', headers: { cookie: session! } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.headers['cache-control'], 'no-store');
  const { userId } = me.json().user;
  assert.match(userId, /^[0-9a-f-]{36}$/);

  const again = await login('/');
  const me2 = await app.inject({ url: '/v1/me', headers: { cookie: again.session! } });
  assert.equal(me2.json().user.userId, userId);
  assert.equal(count('app_user'), 1);

  const out = await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { cookie: session! } });
  assert.equal(out.statusCode, 204);
  assert.equal((await app.inject({ url: '/v1/me', headers: { cookie: session! } })).statusCode, 401);
  assert.equal((await app.inject({ url: '/v1/me', headers: { cookie: again.session! } })).statusCode, 200); // 다른 기기 세션은 유지
});

test('Google 로그인 실패는 세션을 만들지 않는다: state · 쿠키 변조 · 대상 · 만료 · nonce · 발급자', async () => {
  const { google, login, count } = setup();
  const failed = 'http://localhost:8081/?login=failed';
  const attempt = async (claims: typeof validClaims, tweak = {}) => {
    google.claims = claims;
    const { callback, session } = await login('/result', tweak);
    return { location: callback.headers.location, session };
  };

  assert.deepEqual(await attempt(validClaims, { state: 'wrong-state' }), { location: failed, session: undefined });
  assert.deepEqual(await attempt(validClaims, { cookie: 'saju_oauth=tampered.value' }), { location: failed, session: undefined });
  assert.deepEqual(await attempt(n => ({ ...validClaims(n), aud: 'other-client' })), { location: failed, session: undefined });
  assert.deepEqual(await attempt(n => ({ ...validClaims(n), exp: NOW / 1000 - 1 })), { location: failed, session: undefined });
  assert.deepEqual(await attempt(() => validClaims('other-nonce')), { location: failed, session: undefined });
  assert.deepEqual(await attempt(n => ({ ...validClaims(n), iss: 'https://evil.example' })), { location: failed, session: undefined });
  assert.equal(count('auth_session'), 0);
  assert.equal(count('app_user'), 0);
});

test('사용자가 취소하면 cancelled, 외부 주소로는 돌려보내지 않는다', async () => {
  const { app, login } = setup();
  const cancelled = await app.inject({ url: '/v1/auth/google/callback?error=access_denied&state=x' });
  assert.equal(cancelled.headers.location, 'http://localhost:8081/?login=cancelled');

  for (const evil of ['//evil.example/x', 'https://evil.example', '/\\evil.example']) {
    const { callback } = await login(evil);
    assert.equal(callback.headers.location, 'http://localhost:8081/', evil);
  }
});

test('로그인하지 않으면 /v1/me는 401, CORS는 쿠키 전송을 허용한다', async () => {
  const { app } = setup();
  const me = await app.inject({ url: '/v1/me' });
  assert.equal(me.statusCode, 401);
  assert.equal(me.headers['access-control-allow-credentials'], 'true');
});
