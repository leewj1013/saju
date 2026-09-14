// 궁합: 두 사주(calculate()의 chart)의 관계. IO 없음.
// 점수 가중치는 초기값 — 명리 감수 후 조정한다 (바꾸면 같은 두 사람의 점수가 바뀐다)
import { BRANCHES, ELEMENTS, ELEMENT_KO, STEMS, TEN_GOD_GROUPS } from './tables.ts';

export const RELATIONS = ['PARTNER', 'FAMILY', 'FRIEND'] as const; // 연인 · 가족 · 친구/동료
export type Relation = (typeof RELATIONS)[number];

const mod = (a: number, n: number) => ((a % n) + n) % n;
const element = (stem: number) => Math.floor(stem / 2);
const STRONG = ['STRONG', 'VERY_STRONG'];
const WEAK = ['WEAK', 'VERY_WEAK'];

// 지지 관계: 육합(자축 인해 묘술 진유 사신 오미) · 충(6칸 차이) · 삼합(신자진 해묘미 인오술 사유축 = 4로 나눈 나머지가 같음)
const branchCombine = (x: number, y: number) => mod(x + y, 12) === 1;
const branchClash = (x: number, y: number) => Math.abs(x - y) === 6;
const branchTrine = (x: number, y: number) => x !== y && x % 4 === y % 4;

export function matchFacts(a: any, b: any, relation: Relation) {
  const stemA = STEMS.indexOf(a.dm.stem);
  const stemB = STEMS.indexOf(b.dm.stem);
  const branch = (chart: any, pillar: string) => BRANCHES.indexOf(chart.pillars[pillar].branch);
  const [dayA, dayB, yearA, yearB] = [branch(a, 'day'), branch(b, 'day'), branch(a, 'year'), branch(b, 'year')];

  // 일간 오행 관계 = A 기준으로 본 B 일간의 십성 그룹: 0 비겁(같음) · 1 식상(A가 B를 생) · 2 재성(A가 B를 극) · 3 관성(B가 A를 극) · 4 인성(B가 A를 생)
  const rel = mod(element(stemB) - element(stemA), 5);
  const aSeesB = TEN_GOD_GROUPS[rel];
  const bSeesA = TEN_GOD_GROUPS[mod(-rel, 5)];

  const stemCombine = Math.abs(stemA - stemB) === 5; // 갑기 을경 병신 정임 무계
  const stemClash = Math.abs(stemA - stemB) === 6;   // 갑경 을신 병임 정계
  const dayBranchCombine = branchCombine(dayA, dayB);
  const dayBranchTrine = branchTrine(dayA, dayB);
  const dayBranchClash = branchClash(dayA, dayB);
  const yearBranchCombine = branchCombine(yearA, yearB);
  const yearBranchTrine = branchTrine(yearA, yearB);
  const yearBranchClash = branchClash(yearA, yearB);

  // 한쪽에 없는 오행을 다른 쪽이 가졌는가
  const gets = (x: any, y: any): string[] => x.oh.missing.filter((e: string) => y.oh.count[e] >= 1);
  const aGets = gets(a, b);
  const bGets = gets(b, a);
  const sharedMissing: string[] = a.oh.missing.filter((e: string) => b.oh.missing.includes(e));
  const sharedStrong = ELEMENTS.filter(e => a.oh.ratio[e] > 0.3 && b.oh.ratio[e] > 0.3);

  const strong = (c: any) => STRONG.includes(c.strength.band);
  const weak = (c: any) => WEAK.includes(c.strength.band);
  const strengthPair = strong(a) && strong(b) ? 'BOTH_STRONG'
    : weak(a) && weak(b) ? 'BOTH_WEAK'
    : (strong(a) && weak(b)) || (weak(a) && strong(b)) ? 'STRONG_WEAK'
    : 'EVEN';

  // 상대 일간이 나의 배우자 별(남성 재성 · 여성 관성)인가
  const aSpouse = aSeesB === a.love.spouseStarGroup;
  const bSpouse = bSeesA === b.love.spouseStarGroup;

  let score = 60;
  if (stemCombine) score += 12;
  if (stemClash) score -= 8;
  score += [3, 6, -3, -3, 6][rel]; // 서로 생하는 관계가 가장 좋고, 극하는 관계는 긴장
  if (dayBranchCombine) score += 10;
  if (dayBranchTrine) score += 6;
  if (dayBranchClash) score -= 10;
  if (yearBranchCombine || yearBranchTrine) score += 4;
  if (yearBranchClash) score -= 4;
  score += 3 * Math.min(aGets.length, 2) + 3 * Math.min(bGets.length, 2);
  if (relation === 'PARTNER') score += (aSpouse ? 5 : 0) + (bSpouse ? 5 : 0);
  if (strengthPair === 'STRONG_WEAK') score += 3;
  if (strengthPair === 'BOTH_STRONG') score -= 3;
  score = Math.max(40, Math.min(98, score));
  const band = score >= 85 ? 'EXCELLENT' : score >= 72 ? 'GOOD' : score >= 58 ? 'FAIR' : 'EFFORT';

  // 결과 화면의 근거 칩 (좋음 · 주의)
  const ko = (list: string[]) => list.map(e => ELEMENT_KO[ELEMENTS.indexOf(e)]).join('·');
  const points: { label: string; tone: 'good' | 'care' }[] = [];
  const point = (on: boolean, label: string, tone: 'good' | 'care') => { if (on) points.push({ label, tone }); };
  point(stemCombine, '일간 합', 'good');
  point(dayBranchCombine, '일지 합', 'good');
  point(dayBranchTrine, '일지 삼합', 'good');
  point(aGets.length > 0 && bGets.length > 0, '서로 오행 보완', 'good');
  point((aGets.length > 0) !== (bGets.length > 0), '오행 보완', 'good');
  point(relation === 'PARTNER' && (aSpouse || bSpouse), '배우자 별 인연', 'good');
  point(yearBranchCombine || yearBranchTrine, '띠 궁합', 'good');
  point(stemClash, '일간 충', 'care');
  point(dayBranchClash, '일지 충', 'care');
  point(yearBranchClash, '띠 충', 'care');
  point(sharedMissing.length > 0, `둘 다 ${ko(sharedMissing)} 부족`, 'care');

  return {
    relation, score, band, points, aSeesB, bSeesA,
    stemCombine, stemClash, dayBranchCombine, dayBranchTrine, dayBranchClash, yearBranchCombine, yearBranchTrine, yearBranchClash,
    aGets, bGets, aGetsCount: aGets.length, bGetsCount: bGets.length, mutualComplement: aGets.length > 0 && bGets.length > 0,
    sharedMissing, sharedMissingCount: sharedMissing.length, sharedStrong, sharedStrongCount: sharedStrong.length,
    strengthPair, aSpouse, bSpouse, spouseLink: aSpouse || bSpouse,
  };
}
