// 콘텐츠 운영 도구 (PRD §5.8): 시트(CSV) 로드 · 발행 검증 · 커버리지 시뮬레이션.
// 서버는 시작할 때 CSV를 읽어 검증한 뒤 DB에 발행한다 (src/rules/store.ts).
import fs from 'node:fs';
import path from 'node:path';
import { calculate, SajuInputError } from '../engine/index.ts';
import { CATEGORIES, FILTERS, PLACEHOLDER, buildReport, getPath, leaves } from './engine.ts';
import type { Rule, RuleSet } from './engine.ts';
import { generateConditions } from './conditions.ts';

/** 플레이스홀더 검증 기준 chart: PRD 예시 사용자. 대운이 진행 중이라 모든 경로가 채워져 있다 */
export const SAMPLE_CHART = calculate(
  { gender: 'M', calendar: 'SOLAR', birthDate: '1990-01-01', birthTime: '14:30', regionCode: '11' },
  { jasiMode: 'UNIFIED', longitudeCorrection: true },
  Date.UTC(2026, 8, 13, 3),
).chart;

/** RFC 4180 CSV (따옴표 안의 쉼표·줄바꿈·"" 지원). 첫 줄은 헤더 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows.filter(r => r.some(x => x.trim()));
  return data.map(r => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

/** content/ 의 sections.csv · rules.csv · templates.csv → RuleSet. 조건은 코드 생성기에서 */
export function loadRuleSet(dir: string, version: string): { ruleSet: RuleSet; problems: string[] } {
  const read = (file: string) => parseCsv(fs.readFileSync(path.join(dir, file), 'utf8'));
  const problems: string[] = [];
  const templates = read('templates.csv');

  const rules: Rule[] = read('rules.csv').map(r => {
    const expr: Record<string, string[]> = {};
    for (const k of ['all', 'any', 'none']) if (r[k]) expr[k] = r[k].split(/\s+/);
    return {
      ruleCode: r.rule_code, category: r.category, section: r.section, expr,
      priority: Number(r.priority || 0), exclusiveGroup: r.exclusive_group || null,
      isFallback: r.is_fallback === 'Y', isActive: r.is_active !== 'N',
      templates: templates.filter(t => t.rule_code === r.rule_code)
        .map(t => ({ variantNo: Number(t.variant_no), title: t.title, body: t.body })),
    };
  });
  for (const t of templates) {
    if (!rules.some(r => r.ruleCode === t.rule_code)) problems.push(`templates.csv: 없는 룰의 템플릿 ${t.rule_code}#${t.variant_no}`);
  }

  const sections = read('sections.csv').map(s => ({
    category: s.category, section: s.section, displayOrder: Number(s.display_order), maxItems: Number(s.max_items), titleKo: s.title_ko,
  }));
  const conds = Object.fromEntries(generateConditions().map(c => [c.code, c]));
  return { ruleSet: { version, sections, conds, rules }, problems };
}

/** 발행 검증 (PRD §5.5). 빈 배열이어야 발행 가능 */
export function validateRuleSet(rs: RuleSet): string[] {
  const errors: string[] = [];
  const sectionKeys = new Set(rs.sections.map(s => `${s.category}/${s.section}`));

  for (const s of rs.sections) {
    if (!(s.category in CATEGORIES)) errors.push(`sections.csv: 알 수 없는 카테고리 ${s.category}`);
    if (!(s.maxItems >= 1)) errors.push(`sections.csv: ${s.category}/${s.section}의 max_items는 1 이상이어야 합니다`);
  }
  for (const category of Object.keys(CATEGORIES)) {
    if (!rs.rules.some(r => r.isActive && r.isFallback && r.category === category && r.section === 'SUMMARY')) {
      errors.push(`${category}: SUMMARY fallback 룰이 없습니다`);
    }
  }

  const seen = new Set<string>();
  for (const r of rs.rules) {
    const where = `rules.csv ${r.ruleCode || '(rule_code 없음)'}`;
    if (seen.has(r.ruleCode)) errors.push(`${where}: rule_code 중복`);
    seen.add(r.ruleCode);
    if (!sectionKeys.has(`${r.category}/${r.section}`)) errors.push(`${where}: 없는 섹션 ${r.category}/${r.section}`);
    if (!Number.isInteger(r.priority)) errors.push(`${where}: priority는 정수여야 합니다`);
    if (r.isFallback && leaves(r.expr).length) errors.push(`${where}: fallback 룰에는 조건을 넣지 않습니다`);
    for (const code of leaves(r.expr)) if (!rs.conds[code]) errors.push(`${where}: 없는 조건 코드 ${code}`);
    if (!r.templates.length) errors.push(`${where}: 템플릿이 없습니다`);

    const variants = r.templates.map(t => t.variantNo);
    if (new Set(variants).size !== variants.length || !variants.every(Number.isInteger)) errors.push(`${where}: variant_no가 중복되거나 정수가 아닙니다`);

    for (const t of r.templates) {
      const at = `${where}#${t.variantNo}`;
      const text = `${t.title}\n${t.body}`;
      if (!t.body) errors.push(`${at}: 본문이 비어 있습니다`);
      for (const [, p, filters] of text.matchAll(PLACEHOLDER)) {
        if (p !== 'name' && getPath(SAMPLE_CHART, p) === undefined) errors.push(`${at}: 알 수 없는 플레이스홀더 {{${p}}}`);
        for (const f of filters.split('|').slice(1)) if (!FILTERS.includes(f)) errors.push(`${at}: 알 수 없는 필터 |${f}`);
      }
      if (/\{\{|\}\}/.test(text.replace(PLACEHOLDER, ''))) errors.push(`${at}: 닫히지 않은 플레이스홀더`);
    }
  }
  return errors;
}

/** 무작위 출생 n건으로 리포트를 만들어 섹션별 "fallback만 나옴" · "비어 있음" 비율을 잰다 */
export function coverage(rs: RuleSet, n = 10_000) {
  let seed = 7;
  const rnd = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
  const asOf = Date.UTC(2026, 8, 13, 3);
  const from = Date.UTC(1900, 0, 1);
  const to = Date.UTC(2026, 8, 1);
  const stats = new Map<string, { fallbackOnly: number; empty: number }>();

  let total = 0;
  while (total < n) {
    const iso = new Date(from + rnd() * (to - from)).toISOString();
    const input = {
      gender: rnd() < 0.5 ? 'M' : 'F', calendar: 'SOLAR', birthDate: iso.slice(0, 10),
      birthTime: rnd() < 0.1 ? null : iso.slice(11, 16), regionCode: '11',
    } as const;
    let chart;
    try {
      chart = calculate(input, { jasiMode: 'UNIFIED', longitudeCorrection: true }, asOf).chart;
    } catch (e) {
      if (e instanceof SajuInputError) continue; // 서머타임 공백 시각
      throw e;
    }
    total++;
    for (const c of buildReport(chart, rs).categories) {
      for (const s of c.sections) {
        const key = `${c.category}/${s.section}`;
        const st = stats.get(key) ?? { fallbackOnly: 0, empty: 0 };
        stats.set(key, st);
        if (!s.items.length) st.empty++;
        else if (s.items.every(i => i.isFallback)) st.fallbackOnly++;
      }
    }
  }

  const rows = [...stats].map(([section, s]) => ({ section, fallbackOnlyRate: s.fallbackOnly / total, emptyRate: s.empty / total }));
  const warnings = rows
    .filter(r => r.fallbackOnlyRate > 0.05)
    .map(r => `${r.section}: fallback만 나온 비율 ${(r.fallbackOnlyRate * 100).toFixed(1)}%`);
  return { total, rows, warnings };
}
