// 교차 검증 (PRD §4.8): 무작위 · 절입 경계 · 자시 경계 케이스를 lunar-javascript 결과와 비교.
// lunar-javascript는 시계를 UTC+8로 보므로 연·월주/대운은 같은 instant의 UTC+8 시각,
// 일·시주는 엔진과 같은 보정 시각을 넣어 비교한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import LunarJs from 'lunar-javascript';
import { calculate } from '../src/engine/index.ts';
import { MIN, HOUR, DAY, seoulOffset, seoulWallToUtc, isSeoulDst, terms } from '../src/engine/calendar.ts';
import { STEMS, BRANCHES, STEM_HANJA, BRANCH_HANJA, REGION_LON } from '../src/engine/tables.ts';

const { Solar } = LunarJs;
const AS_OF = Date.UTC(2026, 8, 13, 3);
const REGIONS = Object.keys(REGION_LON);

let seed = 20260913;
const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

const hanja = (p: { stem: string; branch: string }) => STEM_HANJA[STEMS.indexOf(p.stem)] + BRANCH_HANJA[BRANCHES.indexOf(p.branch)];
const eightChar = (ms: number) => {
  const d = new Date(ms);
  return Solar.fromYmdHms(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds())
    .getLunar().getEightChar();
};

function cases() {
  const walls: number[] = [];
  const minUtc = Date.UTC(1900, 0, 2);
  const maxUtc = Date.UTC(2026, 8, 1);
  const toWall = (utc: number) => { const w = utc + seoulOffset(utc); return w - (((w % MIN) + MIN) % MIN); };

  for (let i = 0; i < 300; i++) walls.push(toWall(minUtc + rnd() * (maxUtc - minUtc)));
  const inRange = terms.filter(t => t[0] > minUtc && t[0] < maxUtc);
  for (let i = 0; i < 120; i++) walls.push(toWall(pick(inRange)[0] + (rnd() < 0.5 ? -1 : 1) * (30 + rnd() * 60) * MIN));
  for (let i = 0; i < 40; i++) {
    const day = toWall(minUtc + rnd() * (maxUtc - minUtc - DAY));
    walls.push(day - (((day % DAY) + DAY) % DAY) + (22.5 * 60 + Math.floor(rnd() * 180)) * MIN); // 22:30–01:29
  }
  return walls;
}

test('lunar-javascript 교차 검증 460건', () => {
  const failures: string[] = [];
  let checked = 0;

  for (const wall of cases()) {
    const utc = seoulWallToUtc(wall);
    if (utc === null) continue; // 서머타임 공백 시각
    const d = new Date(wall).toISOString();
    const input = {
      gender: rnd() < 0.5 ? 'M' : 'F', calendar: 'SOLAR', birthDate: d.slice(0, 10), birthTime: d.slice(11, 16), regionCode: pick(REGIONS),
    } as const;
    const options = { jasiMode: rnd() < 0.5 ? 'UNIFIED' : 'SPLIT', longitudeCorrection: rnd() < 0.5 } as const;
    const { chart } = calculate(input, options, AS_OF);
    checked++;

    const corrected = options.longitudeCorrection
      ? utc + REGION_LON[input.regionCode] * 4 * MIN
      : utc + seoulOffset(utc) - (isSeoulDst(utc) ? HOUR : 0);
    const cn = eightChar(utc + 8 * HOUR);
    const local = eightChar(corrected);
    local.setSect(options.jasiMode === 'UNIFIED' ? 1 : 2);
    const yun = cn.getYun(input.gender === 'M' ? 1 : 0, 2);

    const p = chart.pillars as any;
    const ours = [hanja(p.year), hanja(p.month), hanja(p.day), hanja(p.hour), chart.daewoon.direction];
    const ref = [cn.getYear(), cn.getMonth(), local.getDay(), local.getTime(), yun.isForward() ? 'FORWARD' : 'BACKWARD'];
    const refStart = yun.getStartYear() + yun.getStartMonth() / 12 + yun.getStartDay() / 360 + yun.getStartHour() / 8640;
    if (ours.join() !== ref.join() || Math.abs(chart.daewoon.startAgeExact - refStart) > 0.01) {
      failures.push(`${JSON.stringify(input)} ${JSON.stringify(options)} ours=${ours} start=${chart.daewoon.startAgeExact.toFixed(3)} ref=${ref} start=${refStart.toFixed(3)}`);
    }
  }

  assert.ok(checked >= 450, `검증 건수 부족: ${checked}`);
  assert.deepEqual(failures.slice(0, 10), [], `불일치 ${failures.length}/${checked}건`);
});

test('오늘의 일진이 lunar-javascript의 그날 일주와 같다 (200일)', () => {
  const failures: string[] = [];
  for (let i = 0; i < 200; i++) {
    const asOf = Date.UTC(2020, 0, 1, 3) + Math.floor(rnd() * 3650) * DAY; // 서울 정오
    const { chart } = calculate(
      { gender: 'M', calendar: 'SOLAR', birthDate: '1990-01-01', birthTime: '14:30', regionCode: '11' },
      { jasiMode: 'UNIFIED', longitudeCorrection: true },
      asOf,
    );
    const seoul = new Date(asOf + 9 * HOUR);
    const ref = Solar.fromYmd(seoul.getUTCFullYear(), seoul.getUTCMonth() + 1, seoul.getUTCDate()).getLunar().getDayInGanZhi();
    const ours = hanja(chart.today);
    if (ours !== ref || chart.today.date !== seoul.toISOString().slice(0, 10)) failures.push(`${seoul.toISOString().slice(0, 10)} ours=${ours} ref=${ref}`);
  }
  assert.deepEqual(failures, []);
});
