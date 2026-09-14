// 사주 보관함: 로그인 확인 · 저장/중복 · 열기 · 삭제 · 다른 사용자 격리 · 개수 제한 · 암호화
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { buildServer } from '../src/server.ts';
import { openDb } from '../src/db.ts';
import { loadRuleSet } from '../src/rules/authoring.ts';
import { SESSION_COOKIE } from '../src/auth.ts';
import { profileKeys, seal, unseal } from '../src/profiles.ts';

const { ruleSet } = loadRuleSet(path.resolve(import.meta.dirname, '../content'), 'test');
const NOW = Date.UTC(2026, 8, 13, 3);
const DATA_KEY = crypto.randomBytes(32).toString('base64url');

const body = (profile: object = {}, options: object = {}) => ({
  profile: { name: '홍길동', gender: 'M', calendar: 'SOLAR', isLeapMonth: false, birthDate: '1990-01-01', birthTime: '14:30', regionCode: '11', ...profile },
  options: { jasiMode: 'UNIFIED', longitudeCorrection: true, ...options },
});

function setup() {
  const db = openDb(':memory:');
  const app = buildServer({
    ruleSet, db, dataKey: DATA_KEY, now: () => NOW,
    google: { clientId: 'c', clientSecret: 's', cookieSecret: 'x'.repeat(32), publicUrl: 'http://localhost:3000', fetch: (async () => Response.json({})) as typeof fetch },
  });
  /** Google 로그인을 마친 것과 같은 세션을 DB에 바로 만든다 */
  const loginAs = (sub: string) => {
    const userId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO app_user (user_id, provider_uid) VALUES (?, ?)').run(userId, sub);
    db.prepare('INSERT INTO auth_session (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(crypto.createHash('sha256').update(token).digest('base64url'), userId, new Date(NOW + 86_400_000).toISOString());
    return { cookie: `${SESSION_COOKIE}=${token}` };
  };
  const count = () => (db.prepare('SELECT COUNT(*) AS n FROM saju_profile').get() as { n: number }).n;
  return { app, db, loginAs, count };
}

test('로그인하지 않으면 보관함 API는 401', async () => {
  const { app } = setup();
  const routes = [['GET', '/v1/profiles'], ['POST', '/v1/profiles'], ['GET', '/v1/profiles/x'], ['PATCH', '/v1/profiles/x'], ['DELETE', '/v1/profiles/x']] as const;
  for (const [method, url] of routes) {
    const payload = method === 'POST' ? body() : method === 'PATCH' ? { tag: 'SELF' } : undefined;
    const res = await app.inject({ method, url, payload });
    assert.equal(res.statusCode, 401, `${method} ${url}`);
  }
});

test('저장 → 목록 → 같은 사주 다시 저장 → 열기 → 삭제', async () => {
  const { app, db, loginAs, count } = setup();
  const headers = loginAs('user-a');

  const saved = await app.inject({ method: 'POST', url: '/v1/profiles', payload: body(), headers });
  assert.equal(saved.statusCode, 201);
  const { created, profile } = saved.json();
  assert.equal(created, true);
  assert.deepEqual(
    { name: profile.name, birthDate: profile.birthDate, birthTime: profile.birthTime, dayPillar: profile.dayPillar, currentDaewoon: profile.currentDaewoon },
    { name: '홍길동', birthDate: '1990-01-01', birthTime: '14:30', dayPillar: '병인', currentDaewoon: '계유' },
  );

  // DB에는 이름 · 생년월일시가 평문으로 남지 않는다
  const row = db.prepare('SELECT * FROM saju_profile').get() as { name_enc: Uint8Array; birth_enc: Uint8Array; input_hash: string };
  const stored = Buffer.concat([Buffer.from(row.name_enc), Buffer.from(row.birth_enc)]);
  for (const plain of ['홍길동', '1990-01-01', '14:30']) assert.equal(stored.includes(Buffer.from(plain)), false, plain);
  assert.match(row.input_hash, /^[A-Za-z0-9_-]{43}$/);

  // 같은 사주를 다른 계산 방식으로 다시 저장하면 새로 만들지 않고 방식만 바꾼다
  const again = await app.inject({ method: 'POST', url: '/v1/profiles', payload: body({}, { jasiMode: 'SPLIT' }), headers });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().created, false);
  assert.equal(again.json().profile.profileId, profile.profileId);
  assert.equal(again.json().profile.options.jasiMode, 'SPLIT');
  assert.equal(count(), 1);

  const list = await app.inject({ url: '/v1/profiles', headers });
  assert.equal(list.headers['cache-control'], 'no-store');
  assert.equal(list.json().limit, 50);
  assert.deepEqual(list.json().profiles.map((p: { profileId: string }) => p.profileId), [profile.profileId]);

  const opened = await app.inject({ url: `/v1/profiles/${profile.profileId}`, headers });
  assert.equal(opened.statusCode, 200);
  const o = opened.json();
  assert.equal(o.profile.name, '홍길동');
  assert.equal(o.options.jasiMode, 'SPLIT');
  assert.deepEqual(o.reading.chart.pillars.day, { stem: 'BYEONG', branch: 'IN' });
  assert.equal(o.reading.report.categories.length, 7);
  const personality = o.reading.report.categories.find((c: { category: string }) => c.category === 'PERSONALITY');
  assert.match(personality.sections[0].items[0].text, /^홍길동님/);

  assert.equal((await app.inject({ method: 'DELETE', url: `/v1/profiles/${profile.profileId}`, headers })).statusCode, 204);
  assert.deepEqual((await app.inject({ url: '/v1/profiles', headers })).json().profiles, []);
  assert.equal((await app.inject({ url: `/v1/profiles/${profile.profileId}`, headers })).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: `/v1/profiles/${profile.profileId}`, headers })).statusCode, 404);
});

test('다른 사용자의 사주는 보이지도 열리지도 지워지지도 않는다', async () => {
  const { app, loginAs, count } = setup();
  const a = loginAs('user-a');
  const b = loginAs('user-b');
  const { profile } = (await app.inject({ method: 'POST', url: '/v1/profiles', payload: body(), headers: a })).json();

  assert.deepEqual((await app.inject({ url: '/v1/profiles', headers: b })).json().profiles, []);
  assert.equal((await app.inject({ url: `/v1/profiles/${profile.profileId}`, headers: b })).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: `/v1/profiles/${profile.profileId}`, headers: b })).statusCode, 404);
  assert.equal(count(), 1);

  // 같은 출생 정보라도 사용자마다 따로 저장된다
  assert.equal((await app.inject({ method: 'POST', url: '/v1/profiles', payload: body(), headers: b })).statusCode, 201);
  assert.equal(count(), 2);
});

test('태그 지정 · 대표 사주는 한 명만 · 대표가 목록 맨 위', async () => {
  const { app, db, loginAs } = setup();
  const headers = loginAs('user-a');
  const save = async (name: string, birthDate: string) =>
    (await app.inject({ method: 'POST', url: '/v1/profiles', payload: body({ name, birthDate }), headers })).json().profile;
  const patch = (profileId: string, payload: object, as = headers) =>
    app.inject({ method: 'PATCH', url: `/v1/profiles/${profileId}`, payload, headers: as });
  const list = async () => (await app.inject({ url: '/v1/profiles', headers })).json().profiles
    .map((p: { name: string; tag: string | null; isPrimary: boolean }) => `${p.name}:${p.tag ?? '-'}${p.isPrimary ? ':대표' : ''}`);

  const first = await save('첫째', '1990-01-01');
  const second = await save('둘째', '1992-05-05');
  assert.deepEqual({ tag: first.tag, isPrimary: first.isPrimary, thisYearSeun: first.thisYearSeun }, { tag: null, isPrimary: false, thisYearSeun: '병오' });
  assert.deepEqual(await list(), ['둘째:-', '첫째:-']); // 최근 저장 순

  const tagged = await patch(first.profileId, { tag: 'FAMILY' });
  assert.equal(tagged.statusCode, 200);
  assert.equal(tagged.json().profile.tag, 'FAMILY');

  await patch(first.profileId, { isPrimary: true });
  assert.deepEqual(await list(), ['첫째:FAMILY:대표', '둘째:-']);

  await patch(second.profileId, { isPrimary: true, tag: 'FRIEND' }); // 대표를 바꾸면 이전 대표는 해제
  assert.deepEqual(await list(), ['둘째:FRIEND:대표', '첫째:FAMILY']);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM saju_profile WHERE is_primary = 1').get() as { n: number }).n, 1);

  await patch(second.profileId, { isPrimary: false, tag: null });
  assert.deepEqual(await list(), ['둘째:-', '첫째:FAMILY']);

  assert.equal((await patch(first.profileId, { tag: 'BOSS' })).statusCode, 400);
  assert.equal((await patch(first.profileId, {})).statusCode, 400);
  assert.equal((await patch(first.profileId, { isPrimary: true }, loginAs('user-b'))).statusCode, 404);
  assert.deepEqual(await list(), ['둘째:-', '첫째:FAMILY']);

  // 대표는 DB 차원에서도 하나뿐
  assert.throws(() => db.prepare('UPDATE saju_profile SET is_primary = 1').run(), /UNIQUE/);
});

test('입력이 틀리면 400, 50개가 차면 409 (이미 있는 사주 다시 저장은 허용)', async () => {
  const { app, loginAs } = setup();
  const headers = loginAs('user-a');

  const invalid = await app.inject({ method: 'POST', url: '/v1/profiles', payload: body({ birthDate: '1990-02-30' }), headers });
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(invalid.json(), { errors: [{ field: 'birthDate', code: 'DATE_NOT_EXIST' }] });

  for (let i = 0; i < 50; i++) {
    const birthDate = new Date(Date.UTC(1990, 0, 1 + i)).toISOString().slice(0, 10);
    assert.equal((await app.inject({ method: 'POST', url: '/v1/profiles', payload: body({ birthDate }), headers })).statusCode, 201);
  }
  const full = await app.inject({ method: 'POST', url: '/v1/profiles', payload: body({ birthDate: '2000-01-01' }), headers });
  assert.equal(full.statusCode, 409);
  assert.deepEqual(full.json(), { errors: [{ field: null, code: 'ARCHIVE_FULL' }] });
  assert.equal((await app.inject({ method: 'POST', url: '/v1/profiles', payload: body(), headers })).statusCode, 200);
});

test('공유 링크: 회원만 만들고 · 로그인 없이 열람 · 생년월일시 가림 · 만료 · 사주 삭제 시 무효', async () => {
  const { app, db, loginAs } = setup();
  const headers = loginAs('user-a');
  const { profile } = (await app.inject({ method: 'POST', url: '/v1/profiles', payload: body(), headers })).json();
  const share = (hideBirth: boolean, as: object = headers) =>
    app.inject({ method: 'POST', url: `/v1/profiles/${profile.profileId}/share`, payload: { hideBirth }, headers: as });

  assert.equal((await share(true, {})).statusCode, 401);
  assert.equal((await share(true, loginAs('user-b'))).statusCode, 404);

  const hidden = await share(true);
  assert.equal(hidden.statusCode, 201);
  const { token, expiresAt } = hidden.json();
  assert.match(token, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(expiresAt, new Date(NOW + 30 * 86_400_000).toISOString());

  const opened = await app.inject({ url: `/v1/share/${token}` }); // 로그인 쿠키 없이
  assert.equal(opened.statusCode, 200);
  assert.equal(opened.headers['cache-control'], 'no-store');
  const o = opened.json();
  assert.deepEqual(o.profile, { name: '홍길동', gender: 'M' });
  assert.equal(o.reading.converted, null);
  assert.deepEqual(o.reading.chart.pillars.day, { stem: 'BYEONG', branch: 'IN' });
  assert.equal(o.reading.report.categories.length, 7);
  assert.doesNotMatch(opened.body, /1990-01-01|14:30|1989-12-05|경도 보정/);
  // 대운 시작 시각 · 소수점 나이로 출생 시각을 거꾸로 계산할 수 없게
  const dw = o.reading.chart.daewoon;
  assert.ok(dw.list.every((d: { startAt: string; fromAge: number }) => d.startAt.endsWith('-07-01T00:00:00.000Z') && Number.isInteger(d.fromAge)));
  assert.ok(Number.isInteger(dw.startAgeExact) && Number.isInteger(dw.current.yearsToNext));

  const shown = await share(false);
  const full = (await app.inject({ url: `/v1/share/${shown.json().token}` })).json();
  assert.equal(full.profile.birthDate, '1990-01-01');
  assert.equal(full.reading.converted.lunar.date, '1989-12-05');

  assert.equal((await app.inject({ url: '/v1/share/nope' })).statusCode, 404);
  db.prepare('UPDATE share_link SET expires_at = ? WHERE token = ?').run(new Date(NOW - 1).toISOString(), token);
  assert.equal((await app.inject({ url: `/v1/share/${token}` })).statusCode, 404);

  await app.inject({ method: 'DELETE', url: `/v1/profiles/${profile.profileId}`, headers });
  assert.equal((await app.inject({ url: `/v1/share/${shown.json().token}` })).statusCode, 404);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM share_link').get() as { n: number }).n, 0);
});

test('암호화: 원래 값으로 복호화되고, 변조 · 다른 키 · 잘못된 키 길이는 실패', () => {
  const keys = profileKeys(DATA_KEY);
  const blob = seal(keys.enc, '홍길동');
  assert.equal(unseal(keys.enc, blob), '홍길동');
  assert.notDeepEqual(seal(keys.enc, '홍길동'), blob); // 매번 다른 IV

  const tampered = Buffer.from(blob);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => unseal(keys.enc, tampered));
  assert.throws(() => unseal(profileKeys(crypto.randomBytes(32).toString('base64url')).enc, blob));
  assert.throws(() => profileKeys('too-short'), /DATA_ENCRYPTION_KEY/);
});
