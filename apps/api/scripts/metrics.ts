// 서버 로그(JSON 줄)에서 베타 지표 계산 (PRD §1.3)
// 사용법: npm start > api.log 로 서버를 띄워 로그를 모은 뒤  npm run metrics -- api.log
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('사용법: npm run metrics -- api.log');
  process.exit(1);
}

// Windows PowerShell의 > 리다이렉트는 UTF-16으로 저장한다
const buf = fs.readFileSync(file);
const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8');

const routes = new Map<string, string>();
const readingTimes: number[] = [];
const readingStatus: Record<number, number> = {};
const sessions = new Map<string, Set<string>>();
const errors = new Map<string, number>();

for (const line of text.split(/\r?\n/)) {
  if (!line.startsWith('{')) continue;
  let log;
  try { log = JSON.parse(line); } catch { continue; }

  if (log.msg === 'incoming request') {
    routes.set(log.reqId, `${log.req.method} ${log.req.url}`);
  } else if (log.msg === 'request completed' && routes.get(log.reqId) === 'POST /v1/readings') {
    readingStatus[log.res.statusCode] = (readingStatus[log.res.statusCode] ?? 0) + 1;
    if (log.res.statusCode === 200) readingTimes.push(log.responseTime);
  } else if (log.msg === 'event') {
    const seen = sessions.get(log.sessionId) ?? new Set<string>();
    seen.add(log.event);
    sessions.set(log.sessionId, seen);
    if (log.event === 'input_error') {
      const key = `${log.props.field}:${log.props.code}`;
      errors.set(key, (errors.get(key) ?? 0) + 1);
    }
  }
}

const percentile = (xs: number[], p: number) => (xs.length ? xs.toSorted((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))].toFixed(1) : '-');
const started = [...sessions.values()].filter(s => s.has('input_start'));
const reached = started.filter(s => s.has('result_view'));
const viewed = [...sessions.values()].filter(s => s.has('result_view'));
const savedAfterView = viewed.filter(s => s.has('save'));
const rate = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '-');

console.table({
  '결과 API 성공 응답': { 값: readingTimes.length, 목표: '' },
  '결과 API p50 (ms)': { 값: percentile(readingTimes, 0.5), 목표: '' },
  '결과 API p95 (ms)': { 값: percentile(readingTimes, 0.95), 목표: '≤ 300' },
  '입력을 시작한 세션': { 값: started.length, 목표: '' },
  '결과까지 간 세션': { 값: reached.length, 목표: '' },
  '입력 시작 → 결과 도달률': { 값: rate(reached.length, started.length), 목표: '≥ 75%' },
  '결과 조회 → 보관함 저장률': { 값: rate(savedAfterView.length, viewed.length), 목표: '≥ 20%' },
});
console.log('결과 API 응답 코드', readingStatus);
if (errors.size) {
  console.log('자주 난 입력 오류');
  console.table([...errors].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, n]) => ({ '필드:코드': k, 횟수: n })));
}
console.log('공유율은 공유 기능이 붙으면 추가합니다.');
