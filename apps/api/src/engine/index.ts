// 만세력 엔진 (PRD §4). 입력 → 원국 · 파생 지표 · 대운/세운 Context. IO 없음.
import {
  MIN, HOUR, DAY, seoulOffset, seoulWallToUtc, isSeoulDst, lunarToSolar, solarToLunar, lastJeol, nextJeol, ipchun,
} from './calendar.ts';
import {
  STEMS, STEM_KO, STEM_HANJA, BRANCHES, BRANCH_KO, ELEMENTS, ELEMENT_KO, ELEMENT_HANJA, BRANCH_ELEMENT, HIDDEN,
  TEN_GODS, TEN_GOD_GROUPS, TWELVE_STAGES, STAGE_START, MONTH_BRANCH_OH_WEIGHT, STRENGTH_WEIGHT, REGION_LON,
} from './tables.ts';

export const ENGINE_VERSION = '1.0.0';

export type SajuInput = {
  gender: 'M' | 'F';
  calendar: 'SOLAR' | 'LUNAR';
  isLeapMonth?: boolean;
  birthDate: string;          // YYYY-MM-DD (calendar 기준)
  birthTime: string | null;   // HH:mm, null = 시간 모름
  regionCode?: string;        // 기본 '11' 서울
};
export type SajuOptions = { jasiMode: 'UNIFIED' | 'SPLIT'; longitudeCorrection: boolean };
export type FieldError = { field: string; code: string };

export class SajuInputError extends Error {
  errors: FieldError[];
  constructor(errors: FieldError[]) {
    super(errors.map(e => `${e.field}:${e.code}`).join(', '));
    this.errors = errors;
  }
}

const PILLARS = ['year', 'month', 'day', 'hour'] as const;
const YEAR = 365.2422 * DAY;

const mod = (a: number, n: number) => ((a % n) + n) % n;
const element = (stem: number) => Math.floor(stem / 2);
const mainStem = (branch: number) => HIDDEN[branch].at(-1)![0];
const ganjiIdx = (stem: number, branch: number) => mod(6 * stem - 5 * branch, 60);
const ganjiKo = (g: number) => STEM_KO[g % 10] + BRANCH_KO[g % 12];
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** 일간 기준 십성: [그룹 idx, 코드] */
function tenGod(dayStem: number, stem: number): [number, string] {
  const rel = mod(element(stem) - element(dayStem), 5);
  return [rel, TEN_GODS[rel][stem % 2 === dayStem % 2 ? 0 : 1]];
}

function twelveStage(dayStem: number, branch: number): string {
  const start = STAGE_START[dayStem];
  return TWELVE_STAGES[dayStem % 2 === 0 ? mod(branch - start, 12) : mod(start - branch, 12)];
}

function validate(input: SajuInput, options: SajuOptions, asOf: number) {
  const errors: FieldError[] = [];
  const fail = (field: string, code: string) => errors.push({ field, code });

  if (input.gender !== 'M' && input.gender !== 'F') fail('gender', 'GENDER_REQUIRED');
  if (input.calendar !== 'SOLAR' && input.calendar !== 'LUNAR') fail('calendar', 'CALENDAR_INVALID');
  if (options.jasiMode !== 'UNIFIED' && options.jasiMode !== 'SPLIT') fail('jasiMode', 'JASI_MODE_INVALID');
  const lon = REGION_LON[input.regionCode ?? '11'];
  if (lon === undefined) fail('regionCode', 'REGION_INVALID');

  const time = input.birthTime == null ? null : /^([01]\d|2[0-3]):([0-5]\d)$/.exec(input.birthTime);
  if (input.birthTime != null && !time) fail('birthTime', 'TIME_INVALID');

  let solar: [number, number, number] | null = null;
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.birthDate ?? '');
  if (!date) {
    fail('birthDate', 'DATE_NOT_EXIST');
  } else if (input.calendar === 'LUNAR') {
    const r = lunarToSolar(+date[1], +date[2], +date[3], !!input.isLeapMonth);
    if (typeof r === 'string') fail('birthDate', r); else solar = r;
  } else {
    const [y, m, d] = [+date[1], +date[2], +date[3]];
    const t = new Date(Date.UTC(y, m - 1, d));
    if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) fail('birthDate', 'DATE_NOT_EXIST');
    else solar = [y, m, d];
  }

  let dayMs = 0;
  let utc: number | null = null;
  if (solar) {
    dayMs = Date.UTC(solar[0], solar[1] - 1, solar[2]);
    const today = asOf + seoulOffset(asOf);
    if (dayMs < Date.UTC(1900, 0, 1) || dayMs > today - mod(today, DAY)) fail('birthDate', 'DATE_OUT_OF_RANGE');
    // 시간 모름이면 정오 가정 (연·월주, 대운 계산용)
    utc = seoulWallToUtc(dayMs + (time ? (+time[1] * 60 + +time[2]) * MIN : 12 * HOUR));
    if (utc === null) fail('birthTime', 'TIME_NOT_EXIST_DST');
  }

  if (errors.length) throw new SajuInputError(errors);
  return { solar: solar!, dayMs, utc: utc!, lon, hourKnown: time !== null };
}

export function calculate(input: SajuInput, options: SajuOptions, asOf = Date.now()) {
  const { solar, dayMs, utc, lon, hourKnown } = validate(input, options, asOf);
  const notices: { code: string; text: string }[] = [];

  // §4.3 보정 시각: 경도 보정 ON = 지방평균시, OFF = 당시 표준시(서머타임 제거)
  const dst = isSeoulDst(utc);
  const standardOffset = seoulOffset(utc) - (dst ? HOUR : 0);
  const corrected = options.longitudeCorrection ? utc + lon * 4 * MIN : utc + standardOffset;

  // §4.4 ① 연주: 입춘 기준
  const sajuYear = utc >= ipchun(solar[0])[0] ? solar[0] : solar[0] - 1;
  const yearStem = mod(sajuYear - 4, 10);
  const yearBranch = mod(sajuYear - 4, 12);

  // ② 월주: 12절 + 월두법
  const monthBranch = lastJeol(utc)[1];
  const monthStem = mod(yearStem * 2 + 2 + mod(monthBranch - 2, 12), 10);

  // ③ 일주 · ④ 시주: 보정 시각 + 자시 방식
  let dayStart = dayMs;
  let hourBranch: number | null = null;
  let lateNight = false;
  if (hourKnown) {
    const minutes = mod(corrected, DAY) / MIN;
    dayStart = corrected - mod(corrected, DAY);
    lateNight = minutes >= 23 * 60;
    hourBranch = Math.floor((minutes + 60) / 120) % 12;
    if (options.jasiMode === 'UNIFIED' && lateNight) dayStart += DAY;
  }
  const dayIdx = mod(Math.floor(dayStart / DAY) + 2440588 + 49, 60); // JDN + 49
  const dayStem = dayIdx % 10;
  const dayBranch = dayIdx % 12;
  const hourStem = hourBranch === null ? null
    : mod((dayStem + (options.jasiMode === 'SPLIT' && lateNight ? 1 : 0)) * 2 + hourBranch, 10); // 야자시: 다음 날 기준

  const P: Record<string, [number, number] | null> = {
    year: [yearStem, yearBranch],
    month: [monthStem, monthBranch],
    day: [dayStem, dayBranch],
    hour: hourBranch === null ? null : [hourStem!, hourBranch],
  };

  // §4.5 파생 지표
  const pillars: Record<string, unknown> = {};
  const tenGods: Record<string, unknown> = {};
  const hiddenStems: Record<string, unknown> = {};
  const twelveStages: Record<string, unknown> = {};
  const ohCount = [0, 0, 0, 0, 0];
  const ohWeight = [0, 0, 0, 0, 0];
  const ssCount: Record<string, number> = Object.fromEntries(TEN_GODS.flat().map(g => [g, 0]));
  const groupCount: Record<string, number> = Object.fromEntries(TEN_GOD_GROUPS.map(g => [g, 0]));
  let support = 0;
  let available = 0;

  for (const key of PILLARS) {
    const p = P[key];
    if (!p) {
      pillars[key] = tenGods[key] = hiddenStems[key] = twelveStages[key] = null;
      continue;
    }
    const [s, b] = p;
    pillars[key] = { stem: STEMS[s], branch: BRANCHES[b] };
    hiddenStems[key] = HIDDEN[b].map(([h]) => STEMS[h]);
    twelveStages[key] = twelveStage(dayStem, b);

    ohCount[element(s)]++;
    ohWeight[element(s)] += 1;
    ohCount[BRANCH_ELEMENT[b]]++;
    ohWeight[BRANCH_ELEMENT[b]] += key === 'month' ? MONTH_BRANCH_OH_WEIGHT : 1;

    const stemGod = key === 'day' ? null : tenGod(dayStem, s); // 일간 자신은 제외
    const branchGod = tenGod(dayStem, mainStem(b));             // 지지는 정기로 판정
    tenGods[key] = { stem: stemGod && stemGod[1], branch: branchGod[1] };
    for (const [god, pos] of [[stemGod, `${key}Stem`], [branchGod, `${key}Branch`]] as const) {
      if (!god) continue;
      ssCount[god[1]]++;
      groupCount[TEN_GOD_GROUPS[god[0]]]++;
      available += STRENGTH_WEIGHT[pos];
      if (god[0] === 0 || god[0] === 4) support += STRENGTH_WEIGHT[pos]; // 비겁 · 인성
    }
  }

  const ohTotal = ohWeight.reduce((a, b) => a + b, 0);
  const oh = {
    count: Object.fromEntries(ELEMENTS.map((e, i) => [e, ohCount[i]])),
    ratio: Object.fromEntries(ELEMENTS.map((e, i) => [e, ohWeight[i] / ohTotal])),
    max: ELEMENTS[ohWeight.indexOf(Math.max(...ohWeight))],
    missing: ELEMENTS.filter((_, i) => ohCount[i] === 0),
  };

  const score = Math.round((support / available) * 100);
  const band = score <= 24 ? 'VERY_WEAK' : score <= 44 ? 'WEAK' : score <= 55 ? 'BALANCED' : score <= 74 ? 'STRONG' : 'VERY_STRONG';

  // 격국: 월지 비겁 → 건록/양인, 아니면 정기→중기→여기 중 투출된 첫 천간(비겁 제외), 없으면 정기
  const monthMain = tenGod(dayStem, mainStem(monthBranch))[1];
  let gyeok: string;
  if (monthMain === 'BIGYEON') gyeok = 'GEONROK';
  else if (monthMain === 'GEOBJAE') gyeok = 'YANGIN';
  else {
    const visible = [yearStem, monthStem, hourStem];
    const shown = [...HIDDEN[monthBranch]].reverse().map(([h]) => h)
      .find(h => visible.includes(h) && tenGod(dayStem, h)[0] !== 0);
    gyeok = tenGod(dayStem, shown ?? mainStem(monthBranch))[1];
  }

  const present = PILLARS.filter(k => P[k]);
  const stemCombine: string[] = [];
  const branchCombine: string[] = [];
  const branchClash: string[] = [];
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const [sa, ba] = P[present[i]]!;
      const [sb, bb] = P[present[j]]!;
      const pair = `${present[i]}-${present[j]}`;
      if (Math.abs(sa - sb) === 5) stemCombine.push(pair);   // 갑기 을경 병신 정임 무계
      if (mod(ba + bb, 12) === 1) branchCombine.push(pair);  // 자축 인해 묘술 진유 사신 오미
      if (Math.abs(ba - bb) === 6) branchClash.push(pair);   // 자오 축미 인신 묘유 진술 사해
    }
  }

  // §4.6 대운 · 세운
  const luck = (g: number) => {
    const s = g % 10;
    const b = g % 12;
    return {
      stem: STEMS[s], branch: BRANCHES[b], ganjiKo: ganjiKo(g),
      stemGroup: TEN_GOD_GROUPS[tenGod(dayStem, s)[0]],
      branchGroup: TEN_GOD_GROUPS[tenGod(dayStem, mainStem(b))[0]],
      fillsMissing: oh.missing.includes(ELEMENTS[element(s)]) || oh.missing.includes(ELEMENTS[BRANCH_ELEMENT[b]]),
    };
  };

  const forward = (yearStem % 2 === 0) === (input.gender === 'M'); // 양남음녀 순행
  const target = forward ? nextJeol(utc) : lastJeol(utc);
  const startAgeExact = Math.abs(target[0] - utc) / DAY / 3;
  const monthIdx = ganjiIdx(monthStem, monthBranch);
  const age = (asOf - utc) / YEAR;
  const daewoonList = Array.from({ length: 10 }, (_, i) => {
    const fromAge = startAgeExact + 10 * i;
    return {
      order: i + 1, fromAge, startAt: new Date(utc + fromAge * YEAR).toISOString(),
      ...luck(mod(monthIdx + (forward ? i + 1 : -(i + 1)), 60)),
    };
  });
  const cur = daewoonList.findLastIndex(d => d.fromAge <= age);

  const asOfYear = new Date(asOf + seoulOffset(asOf)).getUTCFullYear();
  const seunYear = asOf >= ipchun(asOfYear)[0] ? asOfYear : asOfYear - 1;
  const seunList = Array.from({ length: 10 }, (_, i) => ({ year: seunYear - 1 + i, ...luck(mod(seunYear - 1 + i - 4, 60)) }));

  // 오늘의 운세용 일진: 서울 날짜 기준 오늘의 간지와 원국 일간 · 일지와의 관계
  const todayWall = asOf + seoulOffset(asOf);
  const todayStart = todayWall - mod(todayWall, DAY);
  const todayIdx = mod(Math.floor(todayStart / DAY) + 2440588 + 49, 60);
  const today = {
    date: ymd(todayStart),
    ...luck(todayIdx),
    dayBranchClash: Math.abs((todayIdx % 12) - dayBranch) === 6,
    dayBranchCombine: mod((todayIdx % 12) + dayBranch, 12) === 1,
    dayStemCombine: Math.abs((todayIdx % 10) - dayStem) === 5,
  };

  const spouseStarGroup = input.gender === 'M' ? 'JAESEONG' : 'GWANSEONG';

  if (hourKnown && dst) notices.push({ code: 'DST_REMOVED', text: '서머타임 기간 출생이라 1시간을 빼고 계산했습니다.' });
  if (hourKnown && options.longitudeCorrection) {
    const m = Math.round(lon * 4 - standardOffset / MIN);
    notices.push({ code: 'LONGITUDE_CORRECTED', text: `출생지 경도 보정 ${m < 0 ? '−' : '+'}${Math.abs(m)}분을 적용했습니다.` });
  }
  if (!hourKnown) {
    const dayUtc = dayMs - seoulOffset(utc);
    if (lastJeol(dayUtc + DAY - 1)[0] >= dayUtc) {
      notices.push({ code: 'HOUR_UNKNOWN_JEOL_DAY', text: '절기가 바뀌는 날 태어나 태어난 시간에 따라 월주(입춘일이면 연주)가 달라질 수 있습니다.' });
    }
    notices.push({ code: 'HOUR_UNKNOWN_DAEWOON', text: '태어난 시간을 몰라 대운 시작 시기에 최대 ±4개월 오차가 있습니다.' });
  }

  const lunar = solarToLunar(...solar);
  return {
    converted: {
      solarDate: ymd(dayMs),
      lunar: { date: ymd(Date.UTC(lunar.year, lunar.month - 1, lunar.day)), isLeapMonth: lunar.intercalation },
    },
    notices,
    chart: {
      meta: {
        engineVersion: ENGINE_VERSION, gender: input.gender, hourKnown,
        jasiMode: options.jasiMode, longitudeCorrection: options.longitudeCorrection,
        correctionMin: hourKnown ? Math.round((corrected - utc - seoulOffset(utc)) / MIN) : null,
        dstApplied: hourKnown && dst,
      },
      pillars,
      dm: {
        stem: STEMS[dayStem], element: ELEMENTS[element(dayStem)], yinyang: dayStem % 2 ? 'YIN' : 'YANG',
        nameKo: STEM_KO[dayStem] + ELEMENT_KO[element(dayStem)], hanja: STEM_HANJA[dayStem] + ELEMENT_HANJA[element(dayStem)],
      },
      tenGods,
      hiddenStems,
      twelveStages,
      oh,
      ss: { count: ssCount, group: groupCount },
      strength: { score, band },
      gyeok,
      relations: { stemCombine, branchCombine, branchClash, dayBranchClash: branchClash.some(p => p.includes('day')) },
      love: { spouseStarGroup, spouseStarCount: groupCount[spouseStarGroup] },
      daewoon: {
        direction: forward ? 'FORWARD' : 'BACKWARD',
        number: Math.max(1, Math.round(startAgeExact)),
        startAgeExact,
        list: daewoonList,
        current: cur < 0 ? null : { ...daewoonList[cur], yearsToNext: startAgeExact + 10 * (cur + 1) - age },
      },
      seun: { ...seunList[1], list: seunList },
      today,
    },
  };
}
