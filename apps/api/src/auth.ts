// Google 로그인 (OpenID Connect 인가 코드 + PKCE). 웹 베타: DB 세션 + httpOnly 쿠키
// 요청 범위는 openid 하나 — 이메일 · 이름은 받지 않고 Google 계정 고유 ID(sub)만 저장한다.
// 앱 스토어 빌드는 쿠키를 쓰기 어려워 별도 토큰 방식이 필요하다.
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance, FastifyRequest } from 'fastify';

const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const FLOW_COOKIE = 'saju_oauth';
const FLOW_PATH = '/v1/auth/google';
export const SESSION_COOKIE = 'saju_session';
const SESSION_MS = 14 * 86_400_000;

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  cookieSecret: string; // AUTH_SECRET: 로그인 진행 쿠키 서명
  publicUrl: string;    // 리디렉션 URI = publicUrl + /v1/auth/google/callback (Google Console에 등록)
  fetch?: typeof fetch; // 테스트에서 토큰 엔드포인트 대체
};

type Flow = { state: string; verifier: string; nonce: string; returnTo: string };

const random = () => crypto.randomBytes(32).toString('base64url');
const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('base64url');

/** 같은 사이트 안의 경로만 돌려보낸다 (//evil.com, /\evil.com, https://… 차단) */
const safeReturnPath = (value: unknown) =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/';

/**
 * 토큰 엔드포인트에서 TLS로 직접 받은 ID 토큰이므로 서명 검증 대신 발급자 · 대상 · 만료 · nonce를 확인한다
 * (OpenID Connect Core 3.1.3.7 6항). 반환: Google 계정 고유 ID(sub)
 */
export function verifyIdToken(idToken: unknown, expected: { clientId: string; nonce: string; now: number }): string {
  const payload = typeof idToken === 'string' ? idToken.split('.')[1] : undefined;
  if (!payload) throw new Error('id_token 없음');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const audiences = [claims.aud].flat();
  if (!GOOGLE_ISSUERS.includes(claims.iss)) throw new Error('발급자 불일치');
  if (!audiences.includes(expected.clientId) || (audiences.length > 1 && claims.azp !== expected.clientId)) throw new Error('대상 불일치');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= expected.now) throw new Error('만료된 토큰');
  if (claims.nonce !== expected.nonce) throw new Error('nonce 불일치');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('sub 없음');
  return claims.sub;
}

export function registerGoogleAuth(
  app: FastifyInstance,
  config: GoogleConfig & { db: DatabaseSync; webOrigin?: string; now: () => number },
) {
  const { db, clientId, clientSecret, now } = config;
  const publicUrl = config.publicUrl.replace(/\/+$/, '');
  const redirectUri = `${publicUrl}/v1/auth/google/callback`;
  const cookieBase = { httpOnly: true, sameSite: 'lax' as const, secure: publicUrl.startsWith('https://') };
  // 개발에서는 웹(8081)과 API(3000)가 달라 웹 주소로, 배포에서는 같은 도메인이라 경로로 돌려보낸다
  const toWeb = (path: string) => `${config.webOrigin ?? ''}${path}`;
  const post = config.fetch ?? fetch;

  const userIdOf = (req: FastifyRequest): string | null => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return null;
    const row = db.prepare('SELECT user_id FROM auth_session WHERE token_hash = ? AND expires_at > ?')
      .get(sha256(token), new Date(now()).toISOString()) as { user_id: string } | undefined;
    return row?.user_id ?? null;
  };

  app.get('/v1/auth/google/start', async (req, reply) => {
    const flow: Flow = { state: random(), verifier: random(), nonce: random(), returnTo: safeReturnPath((req.query as { returnTo?: string }).returnTo) };
    reply.setCookie(FLOW_COOKIE, JSON.stringify(flow), { ...cookieBase, path: FLOW_PATH, maxAge: 600, signed: true });

    const url = new URL(GOOGLE_AUTHORIZE);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: sha256(flow.verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return reply.redirect(url.toString());
  });

  app.get('/v1/auth/google/callback', async (req, reply) => {
    const query = req.query as { code?: string; state?: string; error?: string };
    const fail = (result: 'failed' | 'cancelled') => reply.redirect(toWeb(`/?login=${result}`));

    const signed = req.cookies[FLOW_COOKIE];
    reply.clearCookie(FLOW_COOKIE, { ...cookieBase, path: FLOW_PATH });
    let flow: Flow | null = null;
    try {
      const unsigned = signed ? req.unsignCookie(signed) : null;
      flow = unsigned?.valid && unsigned.value ? JSON.parse(unsigned.value) : null;
    } catch {
      flow = null;
    }

    if (query.error) return fail(query.error === 'access_denied' ? 'cancelled' : 'failed');
    if (!flow || !query.code || query.state !== flow.state) return fail('failed');

    let sub: string;
    try {
      const res = await post(GOOGLE_TOKEN, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: query.code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri,
          grant_type: 'authorization_code', code_verifier: flow.verifier,
        }),
      });
      if (!res.ok) throw new Error(`토큰 교환 실패 ${res.status}`);
      const { id_token } = (await res.json()) as { id_token?: string };
      sub = verifyIdToken(id_token, { clientId, nonce: flow.nonce, now: now() });
    } catch (e) {
      req.log.warn({ reason: (e as Error).message }, 'google login failed');
      return fail('failed');
    }

    db.prepare("INSERT INTO app_user (user_id, provider, provider_uid) VALUES (?, 'GOOGLE', ?) ON CONFLICT (provider, provider_uid) DO NOTHING")
      .run(crypto.randomUUID(), sub);
    const { user_id } = db.prepare("SELECT user_id FROM app_user WHERE provider = 'GOOGLE' AND provider_uid = ?").get(sub) as { user_id: string };

    const nowIso = new Date(now()).toISOString();
    const token = random();
    const expires = new Date(now() + SESSION_MS);
    db.prepare('DELETE FROM auth_session WHERE expires_at <= ?').run(nowIso);
    db.prepare('INSERT INTO auth_session (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), user_id, expires.toISOString());
    reply.setCookie(SESSION_COOKIE, token, { ...cookieBase, path: '/', expires });
    return reply.redirect(toWeb(flow.returnTo));
  });

  app.get('/v1/me', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const userId = userIdOf(req);
    if (!userId) return reply.code(401).send({ errors: [{ field: null, code: 'UNAUTHORIZED' }] });
    return { user: { userId } };
  });

  app.post('/v1/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) db.prepare('DELETE FROM auth_session WHERE token_hash = ?').run(sha256(token));
    reply.clearCookie(SESSION_COOKIE, { ...cookieBase, path: '/' });
    return reply.code(204).send();
  });

  return { userIdOf };
}
