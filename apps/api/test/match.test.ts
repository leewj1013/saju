// 궁합: 두 사주 관계 계산 · 점수 · 관계별 리포트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { matchFacts } from '../src/engine/match.ts';
import { buildMatchReport } from '../src/rules/engine.ts';
import { SAMPLE_CHART, loadRuleSet, validateRuleSet } from '../src/rules/authoring.ts';

// 예시 사용자(병인 일주 · 남성 · 기사년생 · 금 없음 · 화 35%)를 바탕으로 상대 일주만 바꾼 여성 사주
const partner = (stem: string, dayBranch: string) => ({
  ...SAMPLE_CHART,
  dm: { ...SAMPLE_CHART.dm, stem },
  pillars: { ...SAMPLE_CHART.pillars, day: { stem, branch: dayBranch } },
  meta: { ...SAMPLE_CHART.meta, gender: 'F' },
  love: { ...SAMPLE_CHART.love, spouseStarGroup: 'GWANSEONG' },
});

test('관계 계산: 병신합 · 인해합 · 서로 배우자 별 · 공통 결핍', () => {
  const m = matchFacts(SAMPLE_CHART, partner('SIN', 'HAE'), 'PARTNER');
  assert.deepEqual(
    { stemCombine: m.stemCombine, stemClash: m.stemClash, day: m.dayBranchCombine, aSeesB: m.aSeesB, bSeesA: m.bSeesA, aSpouse: m.aSpouse, bSpouse: m.bSpouse },
    { stemCombine: true, stemClash: false, day: true, aSeesB: 'JAESEONG', bSeesA: 'GWANSEONG', aSpouse: true, bSpouse: true },
  );
  assert.deepEqual(m.sharedMissing, ['METAL']);
  assert.deepEqual(m.sharedStrong, ['FIRE']);
  // 60 + 병신합 12 + 병화가 신금을 극 -3 + 인해합 10 + 서로 배우자 별 10
  assert.equal(m.score, 89);
  assert.equal(m.band, 'EXCELLENT');
  assert.deepEqual(m.points.map(p => p.label), ['일간 합', '일지 합', '배우자 별 인연', '둘 다 금 부족']);

  // 같은 두 사람이라도 연인이 아니면 배우자 별 가산이 없다
  assert.equal(matchFacts(SAMPLE_CHART, partner('SIN', 'HAE'), 'FRIEND').score, 79);
});

test('관계 계산: 병임충 · 인신충은 낮은 점수, 최저 40점', () => {
  const m = matchFacts(SAMPLE_CHART, partner('IM', 'SHIN'), 'PARTNER');
  assert.equal(m.stemClash, true);
  assert.equal(m.dayBranchClash, true);
  assert.equal(m.aSeesB, 'GWANSEONG');
  assert.equal(m.score, 40); // 60 - 8 - 3 - 10 = 39 → 40
  assert.equal(m.band, 'EFFORT');
  assert.deepEqual(m.points.filter(p => p.tone === 'care').map(p => p.label), ['일간 충', '일지 충', '둘 다 금 부족']);
});

test('궁합 리포트: 관계별 탭 · 모든 섹션 문장 · 이름 유무에 맞는 호칭', () => {
  const { ruleSet, problems } = loadRuleSet(path.resolve(import.meta.dirname, '../content'), 'test');
  assert.deepEqual([...problems, ...validateRuleSet(ruleSet)], []);
  const b = partner('SIN', 'HAE');

  const love = buildMatchReport(SAMPLE_CHART, b, ruleSet, 'PARTNER', { a: '원준', b: '서연' });
  assert.deepEqual(love.categories.map(c => c.title), ['총평', '성격 조화', '연애 · 결혼', '갈등 포인트']);
  const family = buildMatchReport(SAMPLE_CHART, b, ruleSet, 'FAMILY');
  assert.deepEqual(family.categories.map(c => c.category), ['MATCH_TOTAL', 'MATCH_PERSONALITY', 'MATCH_BOND', 'MATCH_CONFLICT']);

  for (const r of [love, family, buildMatchReport(SAMPLE_CHART, partner('IM', 'SHIN'), ruleSet, 'FRIEND')]) {
    for (const c of r.categories) for (const s of c.sections) assert.ok(s.items.length > 0, `${c.category}/${s.section} 비어 있음`);
    const text = r.categories.flatMap(c => c.sections.flatMap(s => s.items.map(i => i.title + i.text))).join('\n');
    assert.doesNotMatch(text, /\{\{|\}\}|undefined|null|NaN/);
  }

  const named = love.categories.flatMap(c => c.sections.flatMap(s => s.items.map(i => i.text))).join('\n');
  assert.match(named, /원준님과 서연님의 궁합은 89점, 아주 잘 맞는 사이입니다/);
  assert.match(named, /서로가 서로의 배우자 별|서연님의 일간은 원준님의 배우자 별/);
  const anonymous = family.categories.flatMap(c => c.sections.flatMap(s => s.items.map(i => i.text))).join('\n');
  assert.match(anonymous, /나와 상대의 궁합은/);
  assert.doesNotMatch(anonymous, /님/);

  // 같은 두 사람 · 같은 관계면 같은 결과
  assert.deepEqual(buildMatchReport(SAMPLE_CHART, b, ruleSet, 'PARTNER', { a: '원준', b: '서연' }), love);
});
