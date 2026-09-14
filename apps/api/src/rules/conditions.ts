// 원자 조건 코드 생성 (PRD §5.3). 콘텐츠팀이 손으로 만들지 않고 여기서 일괄 생성한다.
// 한 번 발행된 코드의 의미는 바꾸지 않는다. 기준을 바꾸려면 새 코드를 추가한다.
import { STEMS, STEM_KO, ELEMENTS, ELEMENT_KO, TEN_GODS, TEN_GOD_GROUPS } from '../engine/tables.ts';
import { RELATIONS } from '../engine/match.ts';
import { LABELS } from './engine.ts';
import type { Condition, Operator } from './engine.ts';

const GYEOKS = ['JEONGGWAN', 'PYEONGWAN', 'JEONGJAE', 'PYEONJAE', 'SIKSIN', 'SANGGWAN', 'JEONGIN', 'PYEONIN', 'GEONROK', 'YANGIN'];
const BANDS = ['VERY_WEAK', 'WEAK', 'BALANCED', 'STRONG', 'VERY_STRONG'];

export function generateConditions(): Condition[] {
  const out: Condition[] = [];
  const add = (code: string, paramKey: string, operator: Operator, value: unknown, labelKo: string) =>
    out.push({ code, paramKey, operator, value, labelKo });

  STEMS.forEach((s, i) => add(`DM_${s}`, 'dm.stem', 'eq', s, `일간 ${STEM_KO[i]}${ELEMENT_KO[Math.floor(i / 2)]}`));

  for (const e of ELEMENTS) {
    const k = LABELS[e];
    add(`OH_${e}_NONE`, `oh.count.${e}`, 'eq', 0, `${k} 없음`);
    add(`OH_${e}_LT_10`, `oh.ratio.${e}`, 'lt', 0.1, `${k} 비율 10% 미만`);
    add(`OH_${e}_GT_30`, `oh.ratio.${e}`, 'gt', 0.3, `${k} 비율 30% 초과`);
    add(`OH_${e}_GT_40`, `oh.ratio.${e}`, 'gt', 0.4, `${k} 비율 40% 초과`);
  }

  for (const g of TEN_GOD_GROUPS) {
    add(`SS_${g}_EQ_0`, `ss.group.${g}`, 'eq', 0, `${LABELS[g]} 없음`);
    add(`SS_${g}_GTE_1`, `ss.group.${g}`, 'gte', 1, `${LABELS[g]} 1개 이상`);
    add(`SS_${g}_GTE_3`, `ss.group.${g}`, 'gte', 3, `${LABELS[g]} 3개 이상`);
  }
  for (const g of TEN_GODS.flat()) {
    add(`SS_${g}_GTE_1`, `ss.count.${g}`, 'gte', 1, `${LABELS[g]} 1개 이상`);
    add(`SS_${g}_GTE_2`, `ss.count.${g}`, 'gte', 2, `${LABELS[g]} 2개 이상`);
  }

  for (const b of BANDS) add(`STR_${b}`, 'strength.band', 'eq', b, LABELS[b]);
  add('STR_WEAK_ANY', 'strength.band', 'in', ['WEAK', 'VERY_WEAK'], '신약 계열');
  add('STR_STRONG_ANY', 'strength.band', 'in', ['STRONG', 'VERY_STRONG'], '신강 계열');

  for (const g of GYEOKS) add(`GYEOK_${g}`, 'gyeok', 'eq', g, `${LABELS[g]}격`);

  for (const g of TEN_GOD_GROUPS) {
    add(`DW_STEM_${g}`, 'daewoon.current.stemGroup', 'eq', g, `현재 대운 천간 ${LABELS[g]}`);
    add(`DW_BRANCH_${g}`, 'daewoon.current.branchGroup', 'eq', g, `현재 대운 지지 ${LABELS[g]}`);
    add(`SEUN_STEM_${g}`, 'seun.stemGroup', 'eq', g, `올해 세운 천간 ${LABELS[g]}`);
    add(`SEUN_BRANCH_${g}`, 'seun.branchGroup', 'eq', g, `올해 세운 지지 ${LABELS[g]}`);
  }
  add('DW_FILLS_MISSING', 'daewoon.current.fillsMissing', 'eq', true, '대운이 결핍 오행 보완');
  add('DW_TRANSITION_SOON', 'daewoon.current.yearsToNext', 'lte', 1, '1년 내 대운 교체');

  for (const g of TEN_GOD_GROUPS) {
    add(`TODAY_STEM_${g}`, 'today.stemGroup', 'eq', g, `오늘 일진 천간 ${LABELS[g]}`);
    add(`TODAY_BRANCH_${g}`, 'today.branchGroup', 'eq', g, `오늘 일진 지지 ${LABELS[g]}`);
  }
  add('TODAY_BRANCH_CLASH', 'today.dayBranchClash', 'eq', true, '오늘 일진 지지가 일지와 충');
  add('TODAY_BRANCH_COMBINE', 'today.dayBranchCombine', 'eq', true, '오늘 일진 지지가 일지와 합');
  add('TODAY_STEM_COMBINE', 'today.dayStemCombine', 'eq', true, '오늘 일진 천간이 일간과 합');

  add('GENDER_M', 'meta.gender', 'eq', 'M', '남성');
  add('GENDER_F', 'meta.gender', 'eq', 'F', '여성');
  add('HOUR_KNOWN', 'meta.hourKnown', 'eq', true, '출생 시간 앎');
  add('REL_DAY_BRANCH_CLASH', 'relations.dayBranchClash', 'eq', true, '일지 충');
  // 배우자 자리(일지)의 십성
  for (const g of TEN_GODS.flat()) add(`DAYBR_${g}`, 'tenGods.day.branch', 'eq', g, `일지 ${LABELS[g]}`);
  add('LOVE_SPOUSE_EQ_0', 'love.spouseStarCount', 'eq', 0, '배우자성 없음');
  add('LOVE_SPOUSE_GTE_3', 'love.spouseStarCount', 'gte', 3, '배우자성 3개 이상');

  // 궁합 (ctx = { a, b, match }). 경로가 match.* 라 개인 리포트에서는 항상 false
  for (const r of RELATIONS) add(`MATCH_REL_${r}`, 'match.relation', 'eq', r, `관계 ${LABELS[r]}`);
  for (const band of ['EXCELLENT', 'GOOD', 'FAIR', 'EFFORT']) add(`MATCH_BAND_${band}`, 'match.band', 'eq', band, `궁합 ${LABELS[band]}`);
  for (const g of TEN_GOD_GROUPS) {
    add(`MATCH_A_SEES_B_${g}`, 'match.aSeesB', 'eq', g, `나에게 상대 일간은 ${LABELS[g]}`);
    add(`MATCH_B_SEES_A_${g}`, 'match.bSeesA', 'eq', g, `상대에게 내 일간은 ${LABELS[g]}`);
  }
  const flags: [string, string, string][] = [
    ['STEM_COMBINE', 'stemCombine', '일간 합'], ['STEM_CLASH', 'stemClash', '일간 충'],
    ['DAY_COMBINE', 'dayBranchCombine', '일지 육합'], ['DAY_TRINE', 'dayBranchTrine', '일지 삼합'], ['DAY_CLASH', 'dayBranchClash', '일지 충'],
    ['YEAR_COMBINE', 'yearBranchCombine', '띠 육합'], ['YEAR_TRINE', 'yearBranchTrine', '띠 삼합'], ['YEAR_CLASH', 'yearBranchClash', '띠 충'],
    ['MUTUAL_COMPLEMENT', 'mutualComplement', '서로 부족 오행 보완'],
    ['A_SPOUSE', 'aSpouse', '상대 일간이 나의 배우자 별'], ['B_SPOUSE', 'bSpouse', '내 일간이 상대의 배우자 별'], ['SPOUSE_LINK', 'spouseLink', '한쪽 이상 배우자 별 인연'],
  ];
  for (const [code, key, label] of flags) add(`MATCH_${code}`, `match.${key}`, 'eq', true, label);
  add('MATCH_A_GETS', 'match.aGetsCount', 'gte', 1, '상대가 내 부족 오행을 가짐');
  add('MATCH_B_GETS', 'match.bGetsCount', 'gte', 1, '내가 상대 부족 오행을 가짐');
  add('MATCH_SHARED_MISSING', 'match.sharedMissingCount', 'gte', 1, '둘 다 같은 오행 없음');
  add('MATCH_SHARED_STRONG', 'match.sharedStrongCount', 'gte', 1, '둘 다 같은 오행 30% 초과');
  const pairs: Record<string, string> = { BOTH_STRONG: '둘 다 신강 계열', BOTH_WEAK: '둘 다 신약 계열', STRONG_WEAK: '한쪽 신강 · 한쪽 신약', EVEN: '신강약 차이 작음' };
  for (const [p, label] of Object.entries(pairs)) add(`MATCH_STR_${p}`, 'match.strengthPair', 'eq', p, label);

  return out;
}
