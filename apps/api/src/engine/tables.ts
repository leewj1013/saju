// 만세력 코드표 (PRD 부록 A–D). 인덱스가 곧 계산 값이므로 순서를 바꾸지 않는다.

export const STEMS = ['GAP', 'EUL', 'BYEONG', 'JEONG', 'MU', 'GI', 'GYEONG', 'SIN', 'IM', 'GYE'];
export const STEM_KO = '갑을병정무기경신임계';
export const STEM_HANJA = '甲乙丙丁戊己庚辛壬癸';

// 申은 천간 辛(SIN)과 구분해 SHIN
export const BRANCHES = ['JA', 'CHUK', 'IN', 'MYO', 'JIN', 'SA', 'O', 'MI', 'SHIN', 'YU', 'SUL', 'HAE'];
export const BRANCH_KO = '자축인묘진사오미신유술해';
export const BRANCH_HANJA = '子丑寅卯辰巳午未申酉戌亥';

export const ELEMENTS = ['WOOD', 'FIRE', 'EARTH', 'METAL', 'WATER'];
export const ELEMENT_KO = '목화토금수';
export const ELEMENT_HANJA = '木火土金水';
export const BRANCH_ELEMENT = [4, 2, 0, 0, 2, 1, 1, 2, 3, 3, 2, 4];

// 지장간 [천간 idx, 일수] 여기 → 중기 → 정기. 마지막 원소가 정기
export const HIDDEN: [number, number][][] = [
  [[8, 10], [9, 20]],          // 자: 임 계
  [[9, 9], [7, 3], [5, 18]],   // 축: 계 신 기
  [[4, 7], [2, 7], [0, 16]],   // 인: 무 병 갑
  [[0, 10], [1, 20]],          // 묘: 갑 을
  [[1, 9], [9, 3], [4, 18]],   // 진: 을 계 무
  [[4, 7], [6, 7], [2, 16]],   // 사: 무 경 병
  [[2, 10], [5, 9], [3, 11]],  // 오: 병 기 정
  [[3, 9], [1, 3], [5, 18]],   // 미: 정 을 기
  [[4, 7], [8, 7], [6, 16]],   // 신: 무 임 경
  [[6, 10], [7, 20]],          // 유: 경 신
  [[7, 9], [3, 3], [4, 18]],   // 술: 신 정 무
  [[4, 7], [0, 7], [8, 16]],   // 해: 무 갑 임
];

// [음양 같음, 음양 다름], 그룹 순서 = (대상 오행 − 일간 오행) mod 5
export const TEN_GODS = [
  ['BIGYEON', 'GEOBJAE'], ['SIKSIN', 'SANGGWAN'], ['PYEONJAE', 'JEONGJAE'],
  ['PYEONGWAN', 'JEONGGWAN'], ['PYEONIN', 'JEONGIN'],
];
export const TEN_GOD_GROUPS = ['BIGEOP', 'SIKSANG', 'JAESEONG', 'GWANSEONG', 'INSEONG'];

export const TWELVE_STAGES = [
  'JANGSAENG', 'MOKYOK', 'GWANDAE', 'GEONROK', 'JEWANG', 'SOE',
  'BYEONG', 'SA', 'MYO', 'JEOL', 'TAE', 'YANG',
];
// 갑~계의 장생지 지지 idx. 양간 순행, 음간 역행
export const STAGE_START = [11, 6, 2, 9, 2, 9, 5, 0, 8, 3];

// 초기값 — 명리 감수 후 조정 (PRD §4.5, 미결 #4). 바꾸면 ENGINE_VERSION도 올린다
export const MONTH_BRANCH_OH_WEIGHT = 1.5;
export const STRENGTH_WEIGHT: Record<string, number> = {
  monthBranch: 30, dayBranch: 15, monthStem: 12, hourStem: 12, hourBranch: 12, yearStem: 10, yearBranch: 9,
};

// 시·도 코드 → 대표 도시 경도 (PRD 부록 D)
export const REGION_LON: Record<string, number> = {
  '11': 126.98, '26': 129.08, '27': 128.60, '28': 126.71, '29': 126.85, '30': 127.38,
  '31': 129.31, '36': 127.29, '41': 127.03, '43': 127.49, '44': 126.66, '46': 126.46,
  '47': 128.73, '48': 128.68, '50': 126.53, '51': 127.73, '52': 127.15,
};
