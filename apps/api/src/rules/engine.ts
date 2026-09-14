// 룰 엔진 (PRD §5.5). 만세력 chart + RuleSet → 카테고리·섹션별 해석 문장. IO 없음.
import { STEMS, STEM_KO, BRANCHES, BRANCH_KO, ELEMENTS, ELEMENT_KO } from '../engine/tables.ts';

export type Operator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';
export type Condition = { code: string; paramKey: string; operator: Operator; value: unknown; labelKo: string };
export type Expr = string | { all?: Expr[]; any?: Expr[]; none?: Expr[] };
export type Template = { variantNo: number; title: string; body: string };
export type Rule = {
  ruleCode: string; category: string; section: string; expr: Expr; priority: number;
  exclusiveGroup: string | null; isFallback: boolean; isActive: boolean; templates: Template[];
};
export type Section = { category: string; section: string; displayOrder: number; maxItems: number; titleKo: string };
export type RuleSet = { version: string; sections: Section[]; conds: Record<string, Condition>; rules: Rule[] };
export type DropReason = 'FALLBACK_SKIPPED' | 'EXCLUSIVE_GROUP' | 'MAX_ITEMS';

// 키 순서 = 리포트 노출 순서
export const CATEGORIES: Record<string, string> = {
  TODAY: '오늘의 운세',
  TOTAL: '총운', PERSONALITY: '기본 성향', WEALTH: '재물운', CAREER: '직업운', LOVE: '연애운', DAEWOON: '대운 흐름',
};

// 엔진 코드 → 한글 (템플릿 |ko 필터). 12운성의 병·사·묘는 천간·지지 표기와 같은 글자라 겹쳐도 된다
export const LABELS: Record<string, string> = {
  ...Object.fromEntries(STEMS.map((s, i) => [s, STEM_KO[i]])),
  ...Object.fromEntries(BRANCHES.map((b, i) => [b, BRANCH_KO[i]])),
  ...Object.fromEntries(ELEMENTS.map((e, i) => [e, ELEMENT_KO[i]])),
  BIGYEON: '비견', GEOBJAE: '겁재', SIKSIN: '식신', SANGGWAN: '상관', PYEONJAE: '편재',
  JEONGJAE: '정재', PYEONGWAN: '편관', JEONGGWAN: '정관', PYEONIN: '편인', JEONGIN: '정인',
  BIGEOP: '비겁', SIKSANG: '식상', JAESEONG: '재성', GWANSEONG: '관성', INSEONG: '인성',
  JANGSAENG: '장생', MOKYOK: '목욕', GWANDAE: '관대', GEONROK: '건록', JEWANG: '제왕', SOE: '쇠',
  JEOL: '절', TAE: '태', YANG: '양', YANGIN: '양인',
  VERY_WEAK: '극신약', WEAK: '신약', BALANCED: '중화', STRONG: '신강', VERY_STRONG: '극신강',
  FORWARD: '순행', BACKWARD: '역행', M: '남성', F: '여성',
};

const OPS: Record<Operator, (a: any, b: any) => boolean> = {
  eq: (a, b) => a === b, ne: (a, b) => a !== b,
  gt: (a, b) => a > b, gte: (a, b) => a >= b,
  lt: (a, b) => a < b, lte: (a, b) => a <= b,
  in: (a, b) => b.includes(a), contains: (a, b) => Array.isArray(a) && a.includes(b),
};

export const getPath = (obj: any, path: string) => path.split('.').reduce((o, k) => o?.[k], obj);

/** 코드 문자열 또는 {all, any, none}(중첩 가능). 키가 여럿이면 모두 만족. 값이 없는 파라미터는 항상 false */
export function evalExpr(expr: Expr, ctx: object, conds: Record<string, Condition>): boolean {
  if (typeof expr === 'string') {
    const c = conds[expr];
    const v = getPath(ctx, c.paramKey);
    return v != null && OPS[c.operator](v, c.value);
  }
  const r = (e: Expr) => evalExpr(e, ctx, conds);
  return (!expr.all || expr.all.every(r)) && (!expr.any || expr.any.some(r)) && (!expr.none || !expr.none.some(r));
}

export const leaves = (expr: Expr): string[] =>
  typeof expr === 'string' ? [expr] : [...(expr.all ?? []), ...(expr.any ?? []), ...(expr.none ?? [])].flatMap(leaves);

// {{경로|필터|필터}}
export const PLACEHOLDER = /\{\{([\w.]+)((?:\|[^|}]+)*)\}\}/g;
const JOSA: Record<string, [string, string]> = { 은는: ['은', '는'], 이가: ['이', '가'], 을를: ['을', '를'], 과와: ['과', '와'], 아야: ['아', '야'] };
export const FILTERS = ['ko', 'pct', ...Object.keys(JOSA)];

const hasBatchim = (word: string) => {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 !== 0;
};

export function render(text: string, ctx: object): string {
  return text.replace(PLACEHOLDER, (_, path: string, filters: string) => {
    let v: any = getPath(ctx, path);
    for (const f of filters.split('|').slice(1)) {
      if (f === 'ko') v = Array.isArray(v) ? v.map(x => LABELS[x] ?? x) : (LABELS[v] ?? v);
      else if (f === 'pct') v = `${Math.round(v * 100)}%`;
      else {
        const word = [v].flat().join(', ');
        v = word + JOSA[f][hasBatchim(word) ? 0 : 1];
      }
    }
    return [v ?? ''].flat().join(', ');
  });
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

export function buildReport(chart: any, rs: RuleSet, name?: string) {
  const ctx = { ...chart, name: name || '당신' };
  // 이름이 없으면 "{{name}}님"이 "당신님"이 되지 않도록 "당신"으로 쓴다
  const fill = (text: string) => render(name ? text : text.replaceAll('{{name}}님', '{{name}}'), ctx);
  // 이름은 빼고 8자 + 성별로 문장 변형을 고정: 같은 사주면 어느 기기에서든 같은 문장
  const chartKey = ['year', 'month', 'day', 'hour']
    .map(k => (chart.pillars[k] ? chart.pillars[k].stem + chart.pillars[k].branch : '-')).join('') + chart.meta.gender;
  const order = Object.keys(CATEGORIES);
  const sections = rs.sections.toSorted((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || a.displayOrder - b.displayOrder);

  const trace: { category: string; section: string; ruleCode: string; priority: number; selected: boolean; dropReason: DropReason | null }[] = [];
  const categories: { category: string; title: string; sections: { section: string; title: string; items: any[] }[] }[] = [];

  for (const sec of sections) {
    const matched = rs.rules
      .filter(r => r.isActive && r.category === sec.category && r.section === sec.section && evalExpr(r.expr, ctx, rs.conds))
      .sort((a, b) => b.priority - a.priority || leaves(b.expr).length - leaves(a.expr).length || (a.ruleCode < b.ruleCode ? -1 : 1));
    const hasSpecific = matched.some(r => !r.isFallback);
    const usedGroups = new Set<string>();
    const items = [];

    for (const r of matched) {
      const dropReason: DropReason | null = hasSpecific && r.isFallback ? 'FALLBACK_SKIPPED'
        : r.exclusiveGroup && usedGroups.has(r.exclusiveGroup) ? 'EXCLUSIVE_GROUP'
        : items.length >= sec.maxItems ? 'MAX_ITEMS'
        : null;
      trace.push({ category: sec.category, section: sec.section, ruleCode: r.ruleCode, priority: r.priority, selected: !dropReason, dropReason });
      if (dropReason) continue;
      if (r.exclusiveGroup) usedGroups.add(r.exclusiveGroup);
      const t = r.templates[fnv1a(chartKey + r.ruleCode) % r.templates.length];
      items.push({ ruleCode: r.ruleCode, variantNo: t.variantNo, isFallback: r.isFallback, title: fill(t.title), text: fill(t.body) });
    }

    let cat = categories.find(c => c.category === sec.category);
    if (!cat) categories.push((cat = { category: sec.category, title: CATEGORIES[sec.category], sections: [] }));
    cat.sections.push({ section: sec.section, title: sec.titleKo, items });
  }

  return { ruleSetVersion: rs.version, categories, trace };
}
