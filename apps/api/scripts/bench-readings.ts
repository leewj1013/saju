// POST /v1/readings 성능 측정 (PRD §8: API p95 ≤ 300ms, 엔진+룰 ≤ 20ms)
// 사용법: npm run bench -- [요청 수=2000] [동시성=20]
// 요청 제한을 끈 서버를 이 프로세스 안에서 띄우고 실제 HTTP로 호출한다.
import path from 'node:path';
import { buildServer } from '../src/server.ts';
import { calculate, SajuInputError } from '../src/engine/index.ts';
import { buildReport } from '../src/rules/engine.ts';
import { loadRuleSet } from '../src/rules/authoring.ts';

const total = Number(process.argv[2] ?? 2000);
const concurrency = Number(process.argv[3] ?? 20);

let seed = 42;
const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
const from = Date.UTC(1900, 0, 1);
const to = Date.UTC(2025, 11, 31);
const bodies = Array.from({ length: total + 100 }, () => {
  const iso = new Date(from + rnd() * (to - from)).toISOString();
  return {
    profile: {
      gender: rnd() < 0.5 ? 'M' : 'F', calendar: 'SOLAR', isLeapMonth: false, regionCode: '11',
      birthDate: iso.slice(0, 10), birthTime: rnd() < 0.1 ? null : iso.slice(11, 16),
    },
    options: { jasiMode: rnd() < 0.5 ? 'UNIFIED' : 'SPLIT', longitudeCorrection: rnd() < 0.8 },
  } as const;
});

const percentile = (xs: number[], p: number) => xs.toSorted((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
const summary = (xs: number[]) => ({
  건수: xs.length,
  'p50 (ms)': percentile(xs, 0.5).toFixed(2),
  'p95 (ms)': percentile(xs, 0.95).toFixed(2),
  'p99 (ms)': percentile(xs, 0.99).toFixed(2),
  'max (ms)': Math.max(...xs).toFixed(2),
});

const { ruleSet } = loadRuleSet(path.resolve(import.meta.dirname, '../content'), 'bench');

// 1) 계산 + 해석만 (네트워크 제외)
const pure: number[] = [];
for (const b of bodies.slice(0, 1000)) {
  const t = performance.now();
  try {
    buildReport(calculate(b.profile, b.options).chart, ruleSet);
  } catch (e) {
    if (!(e instanceof SajuInputError)) throw e;
  }
  pure.push(performance.now() - t);
}

// 2) HTTP 왕복 (동시성 N)
const app = buildServer({ ruleSet, allowOrigin: '*', rateLimitPerMin: Infinity });
const url = await app.listen({ port: 0, host: '127.0.0.1' });
const post = async (body: object) => {
  const res = await fetch(`${url}/v1/readings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await res.arrayBuffer();
  return res.status;
};
for (const b of bodies.slice(0, 100)) await post(b); // 워밍업

const http: number[] = [];
const statuses: Record<number, number> = {};
let next = 100;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < bodies.length) {
    const body = bodies[next++];
    const t = performance.now();
    const status = await post(body);
    http.push(performance.now() - t);
    statuses[status] = (statuses[status] ?? 0) + 1;
  }
}));
await app.close();

console.table({ '계산 + 해석': summary(pure), [`HTTP · 동시성 ${concurrency}`]: summary(http) });
console.log('응답 코드', statuses);
