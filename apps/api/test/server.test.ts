// API: 계산 + 해석 응답, 입력 오류, CORS, 요청 제한
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildServer, cleanEventProps } from '../src/server.ts';
import { loadRuleSet } from '../src/rules/authoring.ts';

const { ruleSet } = loadRuleSet(path.resolve(import.meta.dirname, '../content'), 'test');
const NOW = Date.UTC(2026, 8, 13, 3);
const server = (rateLimitPerMin = 20) => buildServer({ ruleSet, allowOrigin: 'http://localhost:8081', rateLimitPerMin, now: () => NOW });
const body = (profile: object = {}) => ({
  profile: { name: '홍길동', gender: 'M', calendar: 'SOLAR', isLeapMonth: false, birthDate: '1990-01-01', birthTime: '14:30', regionCode: '11', ...profile },
  options: { jasiMode: 'UNIFIED', longitudeCorrection: true },
});

test('POST /v1/readings: 원국과 해석을 함께 돌려주고 룰 코드는 숨긴다', async () => {
  const res = await server().inject({ method: 'POST', url: '/v1/readings', payload: body() });
  assert.equal(res.statusCode, 200);
  const r = res.json();
  assert.deepEqual(r.chart.pillars.day, { stem: 'BYEONG', branch: 'IN' });
  assert.equal(r.converted.lunar.date, '1989-12-05');
  assert.equal(r.report.categories.length, 7);
  assert.equal(r.report.categories[0].title, '오늘의 운세');
  assert.equal(r.chart.today.date, '2026-09-13');
  const personality = r.report.categories.find((c: { category: string }) => c.category === 'PERSONALITY');
  assert.equal(personality.sections[0].items[0].text.startsWith('홍길동님'), true);
  assert.doesNotMatch(res.body, /ruleCode|isFallback|trace/);
  for (const c of r.report.categories) for (const s of c.sections) assert.ok(s.items.length > 0);
  assert.equal(res.headers['access-control-allow-origin'], 'http://localhost:8081');
});

test('입력 오류는 필드별 코드로, 형식이 틀린 본문은 BODY_INVALID로', async () => {
  const app = server();
  const bad = await app.inject({ method: 'POST', url: '/v1/readings', payload: body({ birthDate: '1990-02-30' }) });
  assert.equal(bad.statusCode, 400);
  assert.deepEqual(bad.json(), { errors: [{ field: 'birthDate', code: 'DATE_NOT_EXIST' }] });

  const shape = await app.inject({ method: 'POST', url: '/v1/readings', payload: { profile: {} } });
  assert.equal(shape.statusCode, 400);
  assert.deepEqual(shape.json(), { errors: [{ field: null, code: 'BODY_INVALID' }] });
});

test('POST /v1/matches: 두 사람 궁합 · 관계별 탭 · 입력 오류는 사람별 필드', async () => {
  const app = server();
  const b = body({ name: '김서연', gender: 'F', birthDate: '1992-05-05', birthTime: '09:00' });
  const match = (payload: object) => app.inject({ method: 'POST', url: '/v1/matches', payload });

  const res = await match({ a: body(), b, relation: 'PARTNER' });
  assert.equal(res.statusCode, 200);
  const m = res.json();
  assert.equal(m.a.chart.pillars.day.stem, 'BYEONG');
  assert.ok(m.match.score >= 40 && m.match.score <= 98);
  assert.deepEqual(m.report.categories.map((c: { category: string }) => c.category), ['MATCH_TOTAL', 'MATCH_PERSONALITY', 'MATCH_LOVE', 'MATCH_CONFLICT']);
  assert.match(m.report.categories[0].sections[0].items[0].text, /^홍길동님과 김서연님의 궁합은/);
  assert.doesNotMatch(res.body, /ruleCode|isFallback|trace/);

  const family = await match({ a: body(), b, relation: 'FAMILY' });
  assert.deepEqual(family.json().report.categories.map((c: { category: string }) => c.category), ['MATCH_TOTAL', 'MATCH_PERSONALITY', 'MATCH_BOND', 'MATCH_CONFLICT']);

  const bad = await match({ a: body({ birthTime: '25:00' }), b: body({ birthDate: '1990-02-30' }), relation: 'PARTNER' });
  assert.equal(bad.statusCode, 400);
  assert.deepEqual(bad.json(), { errors: [{ field: 'a.birthTime', code: 'TIME_INVALID' }, { field: 'b.birthDate', code: 'DATE_NOT_EXIST' }] });

  assert.equal((await match({ a: body(), b, relation: 'BOSS' })).statusCode, 400);
});

test('CORS preflight', async () => {
  const res = await server().inject({ method: 'OPTIONS', url: '/v1/readings' });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-headers'], 'content-type');
});

test('POST /v1/events: 허용한 이벤트만 받고 속성은 허용 목록으로 거른다', async () => {
  const app = server();
  const ok = await app.inject({ method: 'POST', url: '/v1/events', payload: { sessionId: 's1', name: 'tab_view', props: { category: 'WEALTH' } } });
  assert.equal(ok.statusCode, 204);
  const unknown = await app.inject({ method: 'POST', url: '/v1/events', payload: { sessionId: 's1', name: 'birth_date_typed' } });
  assert.equal(unknown.statusCode, 400);

  assert.deepEqual(cleanEventProps('input_error', { field: 'birthDate', code: 'DATE_NOT_EXIST', birthDate: '1990-01-01' }), { field: 'birthDate', code: 'DATE_NOT_EXIST' });
  assert.deepEqual(cleanEventProps('input_submit', { calendar: 'SOLAR', hourKnown: true, name: '홍길동' }), { calendar: 'SOLAR', hourKnown: true });
  assert.deepEqual(cleanEventProps('tab_view', { category: 'x'.repeat(41) }), {});
});

test('웹 배포: 정적 파일 캐시 · 앱 경로 새로고침 · API 404 · 보안 헤더', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saju-web-'));
  try {
    fs.writeFileSync(path.join(root, 'index.html'), '<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <title>Saju Project</title>\n  </head>\n</html>');
    fs.writeFileSync(path.join(root, 'manifest.webmanifest'), '{"name":"사주"}');
    fs.mkdirSync(path.join(root, '_expo', 'static', 'js', 'web'), { recursive: true });
    fs.writeFileSync(path.join(root, '_expo', 'static', 'js', 'web', 'entry-abc123.js'), 'console.log(1)');
    const app = buildServer({ ruleSet, webRoot: root, noindex: true, publicUrl: 'https://beta.example.com/', now: () => NOW });
    const html = { accept: 'text/html' };

    const home = await app.inject({ url: '/', headers: html });
    assert.equal(home.statusCode, 200);
    assert.match(home.headers['content-type'] as string, /^text\/html/);
    assert.match(home.body, /<html lang="ko">/);
    assert.match(home.body, /<title>사주 四柱/);
    assert.match(home.body, /<meta property="og:image" content="https:\/\/beta\.example\.com\/og\.jpg" \/>/);
    assert.match(home.body, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/);
    assert.equal(home.headers['cache-control'], 'no-cache');
    assert.equal(home.headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal(home.headers['x-content-type-options'], 'nosniff');
    assert.equal(home.headers['access-control-allow-origin'], undefined); // 같은 도메인 배포

    const deep = await app.inject({ url: '/result?from=submit', headers: html });
    assert.equal(deep.statusCode, 200);
    assert.match(deep.body, /og:image/);

    const shared = await buildServer({ ruleSet, webRoot: root, now: () => NOW }).inject({ url: '/s/abc', headers: html });
    assert.equal(shared.headers['x-robots-tag'], 'noindex, nofollow'); // 베타 설정과 무관하게 공유 결과는 검색 제외

    // 카카오톡 미리보기 수집기처럼 Accept: */* 로 와도 앱 경로는 미리보기 정보가 든 HTML
    const scraper = await app.inject({ url: '/s/abc?x=1', headers: { accept: '*/*', 'user-agent': 'kakaotalk-scrap/1.0' } });
    assert.equal(scraper.statusCode, 200);
    assert.match(scraper.body, /og:image/);
    const missingFile = await app.inject({ url: '/missing.png', headers: { accept: '*/*' } });
    assert.equal(missingFile.statusCode, 404); // 없는 파일은 HTML로 덮지 않는다

    const raw = await app.inject({ url: '/index.html', headers: html }); // 원본 템플릿(lang="en", 미리보기 정보 없음)은 내보내지 않는다
    assert.doesNotMatch(raw.body, /lang="en"/);

    const manifest = await app.inject({ url: '/manifest.webmanifest' });
    assert.equal(manifest.statusCode, 200);
    assert.match(manifest.headers['content-type'] as string, /manifest\+json/);

    const asset = await app.inject({ url: '/_expo/static/js/web/entry-abc123.js' });
    assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');

    const missingApi = await app.inject({ url: '/v1/nope', headers: html });
    assert.equal(missingApi.statusCode, 404);
    assert.deepEqual(missingApi.json(), { errors: [{ field: null, code: 'NOT_FOUND' }] });

    const reading = await app.inject({ method: 'POST', url: '/v1/readings', payload: body() });
    assert.equal(reading.statusCode, 200);
    await app.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('프록시 뒤: 로드밸런서가 붙인 오른쪽 끝 IP별로 요청 제한, 앞에 위조한 주소는 무시', async () => {
  const app = buildServer({ ruleSet, proxyHops: 1, rateLimitPerMin: 1, now: () => NOW });
  const as = (forwarded: string) =>
    app.inject({ method: 'POST', url: '/v1/readings', payload: body(), headers: { 'x-forwarded-for': forwarded } });
  assert.deepEqual(
    [(await as('1.1.1.1')).statusCode, (await as('2.2.2.2')).statusCode, (await as('9.9.9.9, 1.1.1.1')).statusCode],
    [200, 200, 429],
  );

  const direct = buildServer({ ruleSet, rateLimitPerMin: 1, now: () => NOW }); // 프록시 없음: 헤더를 믿지 않는다
  const viaDirect = (forwarded: string) =>
    direct.inject({ method: 'POST', url: '/v1/readings', payload: body(), headers: { 'x-forwarded-for': forwarded } });
  assert.deepEqual([(await viaDirect('1.1.1.1')).statusCode, (await viaDirect('2.2.2.2')).statusCode], [200, 429]);
});

test('IP당 분당 요청 제한', async () => {
  const app = server(2);
  const codes = [];
  for (let i = 0; i < 3; i++) codes.push((await app.inject({ method: 'POST', url: '/v1/readings', payload: body() })).statusCode);
  assert.deepEqual(codes, [200, 200, 429]);
});
