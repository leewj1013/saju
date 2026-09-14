// 출생 정보 하나로 룰 매칭 추적과 렌더 결과 확인 (PRD §5.8 preview)
// 사용법: npm run rules:preview -- 1990-01-01 14:30 M [SOLAR|LUNAR] [이름]   (시간 모름은 -)
import path from 'node:path';
import { calculate } from '../src/engine/index.ts';
import type { SajuInput } from '../src/engine/index.ts';
import { buildReport, LABELS } from '../src/rules/engine.ts';
import { loadRuleSet, validateRuleSet } from '../src/rules/authoring.ts';

const [birthDate, birthTime = '-', gender = 'M', calendar = 'SOLAR', name] = process.argv.slice(2);
if (!birthDate) {
  console.error('사용법: npm run rules:preview -- 1990-01-01 14:30 M [SOLAR|LUNAR] [이름]   (시간 모름은 -)');
  process.exit(1);
}

const { ruleSet, problems } = loadRuleSet(path.resolve(import.meta.dirname, '../content'), 'preview');
const errors = [...problems, ...validateRuleSet(ruleSet)];
if (errors.length) {
  for (const e of errors) console.error(`검증 실패: ${e}`);
  process.exit(1);
}

const input = { gender, calendar, birthDate, birthTime: birthTime === '-' ? null : birthTime, regionCode: '11' } as SajuInput;
const { chart } = calculate(input, { jasiMode: 'UNIFIED', longitudeCorrection: true });
const p: any = chart.pillars;
const pillars = ['hour', 'day', 'month', 'year'].map(k => (p[k] ? LABELS[p[k].stem] + LABELS[p[k].branch] : '--')).join(' ');
console.log(`${pillars} (시 일 월 연) · ${chart.dm.nameKo} 일간 · ${LABELS[chart.strength.band]} · ${LABELS[chart.gyeok]}격`);

const report = buildReport(chart, ruleSet, name);
for (const c of report.categories) {
  console.log(`\n■ ${c.title}`);
  for (const s of c.sections) {
    console.log(`  [${s.section}] ${s.title}`);
    for (const t of report.trace.filter(t => t.category === c.category && t.section === s.section)) {
      console.log(`    ${t.selected ? '✔' : '✖'} ${t.ruleCode} (${t.priority})${t.dropReason ? ` ${t.dropReason}` : ''}`);
    }
    for (const i of s.items) console.log(`    → ${i.title}\n      ${i.text}`);
  }
}
