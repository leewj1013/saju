// 룰 엔진 (PRD §5): 조건 평가 · 선택 규칙 · 렌더 · 발행 검증 · 샘플 콘텐츠 매칭
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { buildReport, evalExpr, render } from '../src/rules/engine.ts';
import type { Rule, RuleSet } from '../src/rules/engine.ts';
import { generateConditions } from '../src/rules/conditions.ts';
import { SAMPLE_CHART, SAMPLE_MATCH, coverage, loadRuleSet, parseCsv, validateRuleSet } from '../src/rules/authoring.ts';

const conds = Object.fromEntries(generateConditions().map(c => [c.code, c]));
const content = () => loadRuleSet(path.resolve(import.meta.dirname, '../content'), 'test');
const codesOf = (report: ReturnType<typeof buildReport>, category: string, section: string) =>
  report.categories.find(c => c.category === category)!.sections.find(s => s.section === section)!.items.map(i => i.ruleCode);

test('조건 코드 170개(개인 133 · 궁합 37), 코드 중복 없음, 모든 경로가 chart · 궁합 ctx에 존재', () => {
  const list = generateConditions();
  assert.equal(list.length, 170);
  assert.equal(new Set(list.map(c => c.code)).size, 170);
  assert.equal(list.filter(c => c.code.startsWith('MATCH_')).length, 37);
  for (const c of list) {
    const ctx: any = c.code.startsWith('MATCH_') ? SAMPLE_MATCH : SAMPLE_CHART;
    assert.notEqual(c.paramKey.split('.').reduce((o, k) => o?.[k], ctx), undefined, c.code);
  }
});

test('조건식: all · any · none · 중첩, 값이 없으면 false', () => {
  const ev = (e: any, ctx: object = SAMPLE_CHART) => evalExpr(e, ctx, conds);
  assert.equal(ev('DM_BYEONG'), true);
  assert.equal(ev({ all: ['DM_BYEONG', 'OH_METAL_NONE'] }), true);
  assert.equal(ev({ any: ['DM_GAP', 'STR_BALANCED'] }), true);
  assert.equal(ev({ none: ['GYEOK_JEONGGWAN'] }), false);
  assert.equal(ev({ all: ['DM_BYEONG', { any: ['DM_GAP', 'OH_FIRE_GT_30'] }], none: ['GENDER_F'] }), true);
  assert.equal(ev('STR_WEAK_ANY'), false);
  assert.equal(ev({}), true);
  assert.equal(ev('DW_TRANSITION_SOON', { daewoon: { current: null } }), false);
});

test('렌더: 조사 · |ko · |pct · 배열', () => {
  const ctx = { ...SAMPLE_CHART, name: '홍길동', god: 'GEOBJAE' };
  assert.equal(
    render('{{dm.nameKo|은는}} {{gyeok|ko}}격, 화 {{oh.ratio.FIRE|pct}}, 없는 오행: {{oh.missing|ko}}, {{name|이가}} {{god|ko|이가}}', ctx),
    '병화는 정관격, 화 35%, 없는 오행: 금, 홍길동이 겁재가',
  );
  assert.equal(render('{{x|은는}} {{y|을를}}', { x: '갑목', y: '나무' }), '갑목은 나무를');
});

test('선택: 우선순위 · exclusive_group · fallback · max_items · 문장 변형 고정', () => {
  const rule = (ruleCode: string, section: string, expr: any, priority: number, extra: Partial<Rule> = {}): Rule => ({
    ruleCode, category: 'PERSONALITY', section, expr, priority, exclusiveGroup: null, isFallback: false, isActive: true,
    templates: [{ variantNo: 1, title: '', body: ruleCode }], ...extra,
  });
  const rs: RuleSet = {
    version: 't', conds,
    sections: [
      { category: 'PERSONALITY', section: 'SUMMARY', displayOrder: 1, maxItems: 1, titleKo: '' },
      { category: 'PERSONALITY', section: 'DETAIL', displayOrder: 2, maxItems: 2, titleKo: '' },
    ],
    rules: [
      rule('A', 'SUMMARY', { all: ['DM_BYEONG'] }, 100, { exclusiveGroup: 'G' }),
      rule('B', 'SUMMARY', { all: ['DM_BYEONG', 'STR_BALANCED'] }, 500, { exclusiveGroup: 'G' }),
      rule('F', 'SUMMARY', {}, 0, { isFallback: true }),
      rule('D1', 'DETAIL', { all: ['OH_METAL_NONE'] }, 100),
      rule('D2', 'DETAIL', { all: ['OH_FIRE_GT_30'] }, 300),
      rule('D3', 'DETAIL', { all: ['GYEOK_JEONGGWAN'] }, 100),
      rule('OFF', 'DETAIL', { all: ['DM_BYEONG'] }, 999, { isActive: false }),
      rule('V', 'DETAIL', { all: ['DM_GAP'] }, 999, {
        templates: [1, 2, 3, 4, 5].map(n => ({ variantNo: n, title: '', body: `v${n}` })),
      }),
    ],
  };

  const r = buildReport(SAMPLE_CHART, rs);
  assert.deepEqual(codesOf(r, 'PERSONALITY', 'SUMMARY'), ['B']);
  assert.deepEqual(codesOf(r, 'PERSONALITY', 'DETAIL'), ['D2', 'D1']);
  assert.deepEqual(r.trace.map(t => `${t.ruleCode}:${t.dropReason}`),
    ['B:null', 'A:EXCLUSIVE_GROUP', 'F:FALLBACK_SKIPPED', 'D2:null', 'D1:null', 'D3:MAX_ITEMS']);

  const gap = { ...SAMPLE_CHART, dm: { ...SAMPLE_CHART.dm, stem: 'GAP' } };
  assert.deepEqual(codesOf(buildReport(gap, rs), 'PERSONALITY', 'SUMMARY'), ['F']);
  const variant = (name: string) => buildReport(gap, rs, name).categories[0].sections[1].items[0].variantNo;
  assert.equal(variant('가'), variant('나')); // 이름과 무관하게 같은 사주면 같은 변형
});

test('샘플 콘텐츠: 발행 검증 통과, 예시 사용자 매칭이 PRD §5.4 추적과 일치', () => {
  const { ruleSet, problems } = content();
  assert.deepEqual([...problems, ...validateRuleSet(ruleSet)], []);

  const r = buildReport(SAMPLE_CHART, ruleSet, '홍길동');
  assert.equal(r.categories[0].category, 'TODAY'); // 오늘의 운세가 맨 앞
  assert.deepEqual(codesOf(r, 'TODAY', 'SUMMARY'), ['TODAY_STEM_JAESEONG']); // 2026-09-13 경인일: 병화에게 경금은 재성
  assert.deepEqual(codesOf(r, 'TODAY', 'DETAIL'), ['TODAY_BRANCH_INSEONG']);
  assert.deepEqual(codesOf(r, 'TODAY', 'ADVICE'), ['TODAY_ADVICE_JAESEONG']);
  // 예시 사용자: 병화 · 중화 · 정관격 · 금 없음 · 재성 0 · 일지 편인 · 남성 · 현재 계유 대운 · 2026 병오년
  assert.deepEqual(codesOf(r, 'TOTAL', 'SUMMARY'), ['TOTAL_BALANCED']);
  assert.deepEqual(codesOf(r, 'TOTAL', 'DETAIL'), ['TOTAL_GYEOK_JEONGGWAN', 'TOTAL_METAL_NONE']);
  assert.deepEqual(codesOf(r, 'TOTAL', 'ADVICE'), ['TOTAL_ADVICE_BALANCED']);
  assert.deepEqual(codesOf(r, 'PERSONALITY', 'SUMMARY'), ['PERS_DM_BYEONG']);
  assert.deepEqual(codesOf(r, 'PERSONALITY', 'DETAIL'), ['PERS_GYEOK_JEONGGWAN', 'PERS_FIRE_OVER30', 'PERS_METAL_NONE']);
  assert.deepEqual(codesOf(r, 'PERSONALITY', 'ADVICE'), ['PERS_ADVICE_BALANCED']);
  assert.deepEqual(codesOf(r, 'WEALTH', 'SUMMARY'), ['WEALTH_JAE0_BALANCED']);
  assert.deepEqual(codesOf(r, 'WEALTH', 'DETAIL'), ['WEALTH_JAE0_SIKSANG']);
  assert.deepEqual(codesOf(r, 'WEALTH', 'ADVICE'), ['WEALTH_ADVICE_BALANCED']);
  assert.deepEqual(codesOf(r, 'CAREER', 'SUMMARY'), ['CAREER_GYEOK_JEONGGWAN']);
  assert.deepEqual(codesOf(r, 'CAREER', 'DETAIL'), ['CAREER_GWANIN_SANGSAENG', 'CAREER_SANGGWAN_GYEONGWAN']);
  assert.deepEqual(codesOf(r, 'CAREER', 'ADVICE'), ['CAREER_ADVICE_BALANCED']);
  assert.deepEqual(codesOf(r, 'LOVE', 'SUMMARY'), ['LOVE_SPOUSE_NONE']);
  assert.deepEqual(codesOf(r, 'LOVE', 'DETAIL'), ['LOVE_DAYBR_PYEONIN']);
  assert.deepEqual(codesOf(r, 'LOVE', 'ADVICE'), ['LOVE_ADVICE_NONE']);
  assert.deepEqual(codesOf(r, 'DAEWOON', 'SUMMARY'), ['DW_NEW_JAESEONG']);
  assert.deepEqual(codesOf(r, 'DAEWOON', 'DETAIL'), ['DW_FILLS_MISSING', 'DW_BRANCH_JAE', 'DW_SEUN_BIGEOP']);
  assert.deepEqual(codesOf(r, 'DAEWOON', 'ADVICE'), ['DW_ADVICE_BALANCED']);
  for (const c of r.categories) for (const s of c.sections) assert.ok(s.items.length > 0, `${c.category}/${s.section} 비어 있음`);

  const texts = r.categories.flatMap(c => c.sections.flatMap(s => s.items.map(i => i.title + i.text)));
  for (const t of texts) assert.doesNotMatch(t, /\{\{|\}\}|undefined|null|NaN/);
  assert.match(texts.join('\n'), /배우자를 뜻하는 별인 재성이 드러나/);

  const anonymous = buildReport(SAMPLE_CHART, ruleSet).categories.flatMap(c => c.sections.flatMap(s => s.items.map(i => i.title + i.text))).join('\n');
  assert.doesNotMatch(anonymous, /당신님/);
  assert.match(anonymous, /당신의 사주 한눈에 보기/);
});

test('발행 검증이 막는 경우', () => {
  const { ruleSet } = content();
  const bad = structuredClone(ruleSet);
  bad.rules = bad.rules.filter(r => r.ruleCode !== 'LOVE_FALLBACK');
  bad.rules.find(r => r.ruleCode === 'PERS_METAL_NONE')!.expr = { all: ['NO_SUCH_CODE'] };
  bad.rules.find(r => r.ruleCode === 'PERS_FIRE_OVER30')!.templates[0].body = '{{dm.nope}} {{name|없는필터}} {{깨짐';
  bad.rules.find(r => r.ruleCode === 'CAREER_FALLBACK')!.expr = { all: ['DM_GAP'] };
  bad.rules.push({ ...bad.rules[1], templates: [] });

  const errors = validateRuleSet(bad).join('\n');
  assert.match(errors, /LOVE: SUMMARY fallback 룰이 없습니다/);
  assert.match(errors, /없는 조건 코드 NO_SUCH_CODE/);
  assert.match(errors, /알 수 없는 플레이스홀더 \{\{dm\.nope\}\}/);
  assert.match(errors, /알 수 없는 필터 \|없는필터/);
  assert.match(errors, /닫히지 않은 플레이스홀더/);
  assert.match(errors, /CAREER_FALLBACK: fallback 룰에는 조건을 넣지 않습니다/);
  assert.match(errors, /rule_code 중복/);
  assert.match(errors, /템플릿이 없습니다/);
});

test('CSV 파서: 따옴표 안의 쉼표 · 줄바꿈 · 이스케이프, BOM · CRLF', () => {
  const rows = parseCsv('﻿a,b\r\n"1,2","say ""hi""\nthere"\r\n\r\n3,\r\n');
  assert.deepEqual(rows, [{ a: '1,2', b: 'say "hi"\nthere' }, { a: '3', b: '' }]);
});

test('커버리지 시뮬레이션', () => {
  const { ruleSet } = content();
  const cov = coverage(ruleSet, 200);
  assert.equal(cov.total, 200);
  assert.equal(cov.rows.length, ruleSet.sections.length);
  assert.equal(cov.rows.find(r => r.section === 'PERSONALITY/SUMMARY')!.fallbackOnlyRate, 0); // 일간 10종이 모두 덮음

  // 조건을 빈틈 없이 나눠 두었으므로 어떤 사주 · 어떤 두 사람이든 모든 섹션에 문장이 있고, 요약은 기본 문구로만 채워지지 않는다.
  // 대운 요약만 예외: 첫 대운이 시작되기 전인 어린 사용자는 현재 대운이 없다.
  for (const row of cov.rows) {
    assert.equal(row.emptyRate, 0, `${row.section} 비어 있음 ${row.emptyRate}`);
    if (row.section.endsWith('/SUMMARY') && row.section !== 'DAEWOON/SUMMARY') {
      assert.equal(row.fallbackOnlyRate, 0, `${row.section} fallback만 ${row.fallbackOnlyRate}`);
    }
  }
});
