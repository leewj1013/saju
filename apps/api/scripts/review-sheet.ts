// 명리 감수용 시트 생성 (PRD §4.8 수기 확인, §10 미결 사항)
// 사용법: npm run review:sheet → out/expert-review.csv (엑셀에서 바로 열림)
// 가중치나 기본값을 바꾼 뒤 다시 돌려 같은 케이스로 재검토한다.
import fs from 'node:fs';
import path from 'node:path';
import { calculate } from '../src/engine/index.ts';
import type { SajuInput, SajuOptions } from '../src/engine/index.ts';
import { ELEMENTS } from '../src/engine/tables.ts';
import { LABELS } from '../src/rules/engine.ts';

const AS_OF = Date.UTC(2026, 8, 13, 3);
const base = { regionCode: '11', isLeapMonth: false } as const;

const CASES: [string, SajuInput][] = [
  ['PRD 예시 사용자', { ...base, gender: 'M', calendar: 'SOLAR', birthDate: '1990-01-01', birthTime: '14:30' }],
  ['입춘 30분 전 (2024 입춘 17:27)', { ...base, gender: 'F', calendar: 'SOLAR', birthDate: '2024-02-04', birthTime: '17:00' }],
  ['입춘 30분 후', { ...base, gender: 'F', calendar: 'SOLAR', birthDate: '2024-02-04', birthTime: '18:00' }],
  ['23:30 출생 (자시 방식 차이)', { ...base, gender: 'M', calendar: 'SOLAR', birthDate: '2000-01-01', birthTime: '23:30' }],
  ['00:10 출생 (경도 보정 시 전날 23:37)', { ...base, gender: 'F', calendar: 'SOLAR', birthDate: '2000-01-01', birthTime: '00:10' }],
  ['서머타임 기간 1987-07-01 12:00', { ...base, gender: 'M', calendar: 'SOLAR', birthDate: '1987-07-01', birthTime: '12:00' }],
  ['UTC+8:30 시기 1960-01-15 12:00', { ...base, gender: 'F', calendar: 'SOLAR', birthDate: '1960-01-15', birthTime: '12:00' }],
  ['음력 윤달 1990 윤5월 10일', { ...base, gender: 'M', calendar: 'LUNAR', isLeapMonth: true, birthDate: '1990-05-10', birthTime: '09:00' }],
  ['시간 모름 · 입춘일', { ...base, gender: 'F', calendar: 'SOLAR', birthDate: '2024-02-04', birthTime: null }],
  ['부산 출생 06:59 (경도 보정 −24분)', { ...base, gender: 'M', calendar: 'SOLAR', birthDate: '1975-05-20', birthTime: '06:59', regionCode: '26' }],
];

const METHODS: [string, SajuOptions][] = [
  ['23시 날짜 변경 · 보정 ON', { jasiMode: 'UNIFIED', longitudeCorrection: true }],
  ['야자시·조자시 · 보정 ON', { jasiMode: 'SPLIT', longitudeCorrection: true }],
  ['23시 날짜 변경 · 보정 OFF', { jasiMode: 'UNIFIED', longitudeCorrection: false }],
];

const ganji = (p: any) => (p ? LABELS[p.stem] + LABELS[p.branch] : '--');
const header = ['케이스', '입력', '계산 방식', '사주 (시 일 월 연)', '대운', '오행 가중 비율 (목/화/토/금/수)', '신강약', '격국', '판정 (맞음/다름)', '올바른 값', '의견'];
const rows = [header];

for (const [label, input] of CASES) {
  for (const [method, options] of METHODS) {
    const { chart: c } = calculate(input, options, AS_OF);
    rows.push([
      label,
      `${input.gender === 'M' ? '남' : '여'} · ${input.calendar === 'LUNAR' ? `음력${input.isLeapMonth ? ' 윤달' : ''}` : '양력'} ${input.birthDate} ${input.birthTime ?? '시간 모름'}`,
      method,
      ['hour', 'day', 'month', 'year'].map(k => ganji((c.pillars as any)[k])).join(' '),
      `${LABELS[c.daewoon.direction]} · 대운수 ${c.daewoon.number} (정밀 ${c.daewoon.startAgeExact.toFixed(2)}세) · ${c.daewoon.list[0].ganjiKo}부터`,
      ELEMENTS.map(e => `${Math.round((c.oh.ratio as any)[e] * 100)}%`).join(' / '),
      `${c.strength.score}점 · ${LABELS[c.strength.band]}`,
      `${LABELS[c.gyeok]}격`,
      '', '', '',
    ]);
  }
}

const csv = rows.map(r => r.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n');
const out = path.resolve(import.meta.dirname, '../out/expert-review.csv');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `﻿${csv}\r\n`);
console.log(`${rows.length - 1}행 → ${out}`);
