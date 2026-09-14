// 손으로 검산한 기준값과 경계 정책 (PRD §4.3–4.7)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculate, SajuInputError } from '../src/engine/index.ts';
import type { SajuInput, SajuOptions } from '../src/engine/index.ts';
import { ipchun } from '../src/engine/calendar.ts';

const AS_OF = Date.UTC(2026, 8, 13, 3); // 2026-09-13 12:00 KST
const BASE: SajuInput = { gender: 'M', calendar: 'SOLAR', birthDate: '1990-01-01', birthTime: '14:30', regionCode: '11' };
const OPTS: SajuOptions = { jasiMode: 'UNIFIED', longitudeCorrection: true };
const run = (i: Partial<SajuInput> = {}, o: Partial<SajuOptions> = {}) => calculate({ ...BASE, ...i }, { ...OPTS, ...o }, AS_OF);
const gz = (p: any) => p && `${p.stem}/${p.branch}`;
const four = (c: any) => ['year', 'month', 'day', 'hour'].map(k => gz(c.pillars[k]));
const codes = (fn: () => unknown) => {
  try { fn(); } catch (e) { if (e instanceof SajuInputError) return e.errors.map(x => x.code); throw e; }
  return [];
};

test('예시 사용자: 1990-01-01 14:30 남 서울', () => {
  const { chart: c, converted, notices } = run();
  assert.deepEqual(four(c), ['GI/SA', 'BYEONG/JA', 'BYEONG/IN', 'EUL/MI']);
  assert.deepEqual(converted, { solarDate: '1990-01-01', lunar: { date: '1989-12-05', isLeapMonth: false } });
  assert.deepEqual(c.tenGods, {
    year: { stem: 'SANGGWAN', branch: 'BIGYEON' }, month: { stem: 'BIGYEON', branch: 'JEONGGWAN' },
    day: { stem: null, branch: 'PYEONIN' }, hour: { stem: 'JEONGIN', branch: 'SANGGWAN' },
  });
  assert.deepEqual(c.twelveStages, { year: 'GEONROK', month: 'TAE', day: 'JANGSAENG', hour: 'SOE' });
  assert.deepEqual(c.hiddenStems.month, ['IM', 'GYE']);
  assert.deepEqual(c.oh.count, { WOOD: 2, FIRE: 3, EARTH: 2, METAL: 0, WATER: 1 });
  assert.equal(c.oh.ratio.WATER.toFixed(3), '0.176');
  assert.equal(c.oh.max, 'FIRE');
  assert.deepEqual(c.oh.missing, ['METAL']);
  assert.deepEqual(c.ss.group, { BIGEOP: 2, SIKSANG: 2, JAESEONG: 0, GWANSEONG: 1, INSEONG: 2 });
  assert.deepEqual(c.strength, { score: 48, band: 'BALANCED' });
  assert.equal(c.gyeok, 'JEONGGWAN');
  assert.deepEqual(c.relations, { stemCombine: [], branchCombine: [], branchClash: [], dayBranchClash: false });
  assert.deepEqual(c.love, { spouseStarGroup: 'JAESEONG', spouseStarCount: 0 });
  assert.equal(c.meta.correctionMin, -32);
  assert.deepEqual(notices.map(n => n.code), ['LONGITUDE_CORRECTED']);

  assert.equal(c.daewoon.direction, 'BACKWARD');
  assert.equal(c.daewoon.number, 8);
  assert.deepEqual(c.daewoon.list.slice(0, 4).map(d => d.ganjiKo), ['을해', '갑술', '계유', '임신']);
  assert.equal(c.daewoon.current!.ganjiKo, '계유');
  assert.equal(c.daewoon.current!.branchGroup, 'JAESEONG');
  assert.equal(c.daewoon.current!.fillsMissing, true);
  assert.equal(c.seun.year, 2026);
  assert.equal(c.seun.ganjiKo, '병오');
});

test('오늘의 일진: 서울 날짜 기준 간지와 일간 · 일지 관계', () => {
  const todayAt = (iso: string) => calculate(BASE, OPTS, Date.parse(iso)).chart.today;
  const t = todayAt('2026-09-13T03:00:00Z'); // 예시 사용자: 병화 일간, 일지 인
  assert.deepEqual(
    { date: t.date, ganjiKo: t.ganjiKo, stemGroup: t.stemGroup, branchGroup: t.branchGroup },
    { date: '2026-09-13', ganjiKo: '경인', stemGroup: 'JAESEONG', branchGroup: 'INSEONG' },
  );
  assert.deepEqual([t.dayBranchClash, t.dayBranchCombine, t.dayStemCombine], [false, false, false]);
  assert.equal(todayAt('2026-09-19T03:00:00Z').dayBranchClash, true);   // 병신일: 인신충
  assert.equal(todayAt('2026-09-22T03:00:00Z').dayBranchCombine, true); // 기해일: 인해합
  assert.equal(todayAt('2026-09-14T03:00:00Z').dayStemCombine, true);   // 신묘일: 병신합
  assert.equal(todayAt('2026-09-13T15:30:00Z').date, '2026-09-14');     // 서울 자정이 지나면 다음 날
});

test('일주 기준점과 연주', () => {
  assert.equal(gz(run({ birthDate: '2000-01-01', birthTime: '12:00' }).chart.pillars.day), 'MU/O');
  assert.equal(gz(run({ birthDate: '1984-03-01' }).chart.pillars.year), 'GAP/JA');
});

test('입춘 절입 시각이 KASI 공표값과 2분 이내', () => {
  // KASI: 2024 입춘 02-04 17:27, 2025 입춘 02-03 23:10 (KST)
  for (const [year, kst] of [[2024, Date.UTC(2024, 1, 4, 17, 27)], [2025, Date.UTC(2025, 1, 3, 23, 10)]]) {
    assert.ok(Math.abs(ipchun(year)[0] - (kst - 9 * 3_600_000)) <= 2 * 60_000, `${year} 입춘`);
  }
  assert.equal(gz(run({ birthDate: '2024-02-04', birthTime: '17:00' }).chart.pillars.year), 'GYE/MYO');
  assert.equal(gz(run({ birthDate: '2024-02-04', birthTime: '18:00' }).chart.pillars.year), 'GAP/JIN');
});

test('자시 방식: 경도 보정 OFF', () => {
  const noCorr = { longitudeCorrection: false };
  const at = (t: string, jasiMode: 'UNIFIED' | 'SPLIT') => four(run({ birthDate: '2000-01-01', birthTime: t }, { ...noCorr, jasiMode }).chart).slice(2);
  assert.deepEqual(at('22:59', 'UNIFIED'), ['MU/O', 'GYE/HAE']);
  assert.deepEqual(at('23:30', 'UNIFIED'), ['GI/MI', 'GAP/JA']);   // 23시에 날짜 변경
  assert.deepEqual(at('23:30', 'SPLIT'), ['MU/O', 'GAP/JA']);      // 야자시: 일주 당일, 시주는 다음 날 기준
  assert.deepEqual(at('00:30', 'SPLIT'), ['MU/O', 'IM/JA']);       // 조자시
});

test('자시 방식: 경도 보정으로 00:10이 전날 23:37이 되는 경우', () => {
  const at = (jasiMode: 'UNIFIED' | 'SPLIT') => four(run({ birthDate: '2000-01-01', birthTime: '00:10' }, { jasiMode }).chart).slice(2);
  assert.deepEqual(at('UNIFIED'), ['MU/O', 'IM/JA']);
  assert.deepEqual(at('SPLIT'), ['JEONG/SA', 'IM/JA']);
});

test('서머타임 · 표준시 변경', () => {
  const summer = run({ birthDate: '1987-07-01', birthTime: '12:00' });
  assert.equal(summer.chart.meta.dstApplied, true);
  assert.equal(summer.chart.meta.correctionMin, -92);
  assert.deepEqual(summer.notices.map(n => n.code), ['DST_REMOVED', 'LONGITUDE_CORRECTED']);
  assert.equal(run({ birthDate: '1961-12-01', birthTime: '12:00' }).chart.meta.dstApplied, false);
  assert.equal(run({ birthDate: '1960-01-15', birthTime: '12:00' }, { longitudeCorrection: false }).chart.meta.correctionMin, 0);
  assert.deepEqual(codes(() => run({ birthDate: '1987-05-10', birthTime: '02:30' })), ['TIME_NOT_EXIST_DST']);
});

test('음력 입력', () => {
  assert.equal(run({ calendar: 'LUNAR', birthDate: '1989-12-05' }).converted.solarDate, '1990-01-01');
  assert.deepEqual(run({ calendar: 'LUNAR', birthDate: '1990-05-10', isLeapMonth: true }).converted.lunar, { date: '1990-05-10', isLeapMonth: true });
  assert.deepEqual(codes(() => run({ calendar: 'LUNAR', birthDate: '1989-12-05', isLeapMonth: true })), ['LEAP_MONTH_NOT_EXIST']);
});

test('시간 모름', () => {
  const { chart: c, notices } = run({ birthTime: null });
  assert.equal(c.pillars.hour, null);
  assert.deepEqual(four(c).slice(0, 3), ['GI/SA', 'BYEONG/JA', 'BYEONG/IN']);
  assert.equal(Object.values(c.oh.count).reduce((a, b) => a + b, 0), 6);
  assert.deepEqual(notices.map(n => n.code), ['HOUR_UNKNOWN_DAEWOON']);
  assert.deepEqual(run({ birthDate: '2024-02-04', birthTime: null }).notices.map(n => n.code), ['HOUR_UNKNOWN_JEOL_DAY', 'HOUR_UNKNOWN_DAEWOON']);
});

test('입력 검증', () => {
  assert.deepEqual(codes(() => run({ birthDate: '1990-02-30' })), ['DATE_NOT_EXIST']);
  assert.deepEqual(codes(() => run({ birthDate: '1899-12-31' })), ['DATE_OUT_OF_RANGE']);
  assert.deepEqual(codes(() => run({ birthDate: '2026-09-14' })), ['DATE_OUT_OF_RANGE']);
  assert.deepEqual(codes(() => run({ birthTime: '24:00' })), ['TIME_INVALID']);
  assert.deepEqual(codes(() => run({ gender: 'X' as any, regionCode: '99' })), ['GENDER_REQUIRED', 'REGION_INVALID']);
});
