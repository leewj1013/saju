// 콘텐츠 시트(content/*.csv) 발행 검증 + 커버리지 시뮬레이션
// 통과한 CSV를 반영해 배포하면, 서버가 시작할 때 새 버전으로 DB에 저장 · 발행한다 (src/rules/store.ts)
// 사용법: npm run rules:import   (COVERAGE_N=1000 으로 시뮬레이션 건수 조정)
import path from 'node:path';
import { coverage, loadRuleSet, validateRuleSet } from '../src/rules/authoring.ts';
import { versionOf } from '../src/rules/store.ts';

const { ruleSet, problems } = loadRuleSet(path.resolve(import.meta.dirname, '../content'), '');
const errors = [...problems, ...validateRuleSet(ruleSet)];
if (errors.length) {
  console.error(`발행 검증 실패 ${errors.length}건`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const cov = coverage(ruleSet, Number(process.env.COVERAGE_N ?? 10_000));
console.log(`커버리지 시뮬레이션 ${cov.total}건`);
console.table(cov.rows.map(r => ({ 섹션: r.section, 'fallback만': `${(r.fallbackOnlyRate * 100).toFixed(1)}%`, '비어 있음': `${(r.emptyRate * 100).toFixed(1)}%` })));
for (const w of cov.warnings) console.warn(`경고: ${w}`);

const templateCount = ruleSet.rules.reduce((n, r) => n + r.templates.length, 0);
console.log(`검증 통과 · 버전 ${versionOf(ruleSet)} · 룰 ${ruleSet.rules.length}개 · 템플릿 ${templateCount}개 · 조건 ${Object.keys(ruleSet.conds).length}개`);
console.log('배포하면 서버가 시작할 때 이 버전을 DB에 저장하고 발행합니다.');
