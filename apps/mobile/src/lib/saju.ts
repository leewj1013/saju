// 앱 공용: API 호출 · 기기 저장 · 입력 검증 · 표시용 코드표
import AsyncStorage from '@react-native-async-storage/async-storage';
import KoreanLunarCalendar from 'korean-lunar-calendar';
// 코드표와 라벨은 API 원본을 그대로 쓴다 (metro.config.js)
import {
  BRANCHES, BRANCH_ELEMENT, BRANCH_HANJA, ELEMENTS, ELEMENT_HANJA, HIDDEN, REGION_LON, STEMS, STEM_HANJA,
} from '../../../api/src/engine/tables.ts';
import { LABELS } from '../../../api/src/rules/engine.ts';

export { ELEMENTS, ELEMENT_HANJA, LABELS };

// 개발: 로컬 API. 웹 배포: API와 같은 도메인이라 빈 값(상대 경로). 앱 스토어 빌드는 EXPO_PUBLIC_API_URL을 반드시 지정
export const API_URL = process.env.EXPO_PUBLIC_API_URL || (__DEV__ ? 'http://localhost:3000' : '');

export type Gender = 'M' | 'F';
export type Profile = {
  name: string; gender: Gender; calendar: 'SOLAR' | 'LUNAR'; isLeapMonth: boolean;
  birthDate: string; birthTime: string | null; regionCode: string;
};
export type Options = { jasiMode: 'UNIFIED' | 'SPLIT'; longitudeCorrection: boolean };
export type ReportItem = { title: string; text: string };
export type Reading = {
  converted: { solarDate: string; lunar: { date: string; isLeapMonth: boolean } } | null; // null = 공유 링크에서 생년월일시 가림
  notices: { code: string; text: string }[];
  chart: any;
  report: {
    ruleSetVersion: string;
    categories: { category: string; title: string; sections: { section: string; title: string; items: ReportItem[] }[] }[];
  };
};
export type Saved = { profile: Profile; options: Options; reading: Reading };
export type FieldError = { field: string | null; code: string };

export class ReadingError extends Error {
  errors: FieldError[];
  constructor(errors: FieldError[]) {
    super(errors.map(e => e.code).join(', '));
    this.errors = errors;
  }
}

const MESSAGES: Record<string, string> = {
  GENDER_REQUIRED: '성별을 선택해 주세요.',
  DATE_NOT_EXIST: '존재하지 않는 날짜입니다.',
  DATE_OUT_OF_RANGE: '1900년 1월 1일부터 오늘까지 입력할 수 있습니다.',
  LEAP_MONTH_NOT_EXIST: '그해에는 해당 윤달이 없습니다. 평달로 바꿔 주세요.',
  TIME_INVALID: '00:00부터 23:59 사이로 입력해 주세요.',
  TIME_NOT_EXIST_DST: '서머타임이 시작되며 건너뛴 시각이라 존재하지 않습니다. 앞뒤 시각으로 입력해 주세요.',
  RATE_LIMITED: '요청이 많습니다. 1분 뒤 다시 시도해 주세요.',
  NETWORK: '서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.',
  UNAUTHORIZED: '로그인이 필요합니다.',
  ARCHIVE_FULL: '보관함이 가득 찼습니다(최대 50개). 안 보는 사주를 지운 뒤 다시 저장해 주세요.',
  NOT_FOUND: '보관함에서 찾을 수 없는 사주입니다. 목록을 새로 불러와 주세요.',
  PENDING_EXPIRED: '로그인하는 동안 시간이 오래 지나 결과를 가져오지 못했어요. 사주 정보를 다시 입력해 주세요.',
};
export const errorMessage = (code: string) => MESSAGES[code] ?? '결과를 만들지 못했습니다. 잠시 뒤 다시 시도해 주세요.';

// ── 로그인 (웹 베타: 서버 세션 쿠키). 앱 스토어 빌드는 토큰 방식이 따로 필요해 지금은 웹에서만 노출
export type Me = { userId: string };

/** 지금 로그인돼 있으면 사용자, 아니면 null (서버에 연결할 수 없을 때도 null) */
export async function fetchMe(): Promise<Me | null> {
  try {
    const res = await fetch(`${API_URL}/v1/me`, { credentials: 'include' });
    return res.ok ? (await res.json()).user : null;
  } catch {
    return null;
  }
}
export const logout = () => fetch(`${API_URL}/v1/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
const googleLoginUrl = (returnTo: string) => `${API_URL}/v1/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`;

// Google은 앱 안 브라우저(웹뷰)에서 로그인을 막는다(403 disallowed_useragent). 국내는 카카오톡으로 링크를 여는 경우가 많다
const IN_APP = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|; wv\)/i;

export const inAppBrowser = () => IN_APP.test(navigator.userAgent);

/** 앱 안 브라우저에서 url을 기본 브라우저로 연다. 넘길 방법이 없으면(iOS의 카카오톡 외 앱) false */
export function openInExternalBrowser(url: string): boolean {
  const ua = navigator.userAgent;
  if (/KAKAOTALK/i.test(ua)) {
    window.location.href = `kakaotalk://web/openExternal?url=${encodeURIComponent(url)}`;
    return true;
  }
  if (/Android/i.test(ua)) {
    const [scheme, rest] = url.split('://');
    window.location.href = `intent://${rest}#Intent;scheme=${scheme};package=com.android.chrome;end`;
    return true;
  }
  return false;
}

/** Google 로그인 시작. 앱 안 브라우저면 기본 브라우저로 넘기고, 넘길 수 없으면 방법을 안내한다 */
export function startGoogleLogin(returnTo: string) {
  const url = new URL(googleLoginUrl(returnTo), window.location.href).href;
  if (!inAppBrowser()) {
    window.location.href = url;
  } else if (!openInExternalBrowser(url)) {
    window.alert('이 앱 안의 브라우저에서는 Google 로그인을 할 수 없어요.\n화면의 메뉴(…)에서 "Safari로 열기" 또는 "다른 브라우저로 열기"를 누른 뒤 다시 로그인해 주세요.');
  }
}

// 계측 (PRD §8): 이벤트 이름과 허용 속성만 보낸다. 세션 ID는 앱을 켤 때마다 새로 만들어 사람을 추적하지 않는다
const SESSION_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
export function track(name: string, props?: Record<string, string | number | boolean>) {
  fetch(`${API_URL}/v1/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: SESSION_ID, name, props }),
    keepalive: true,
  }).catch(() => {});
}

/** API 호출 공용: 로그인 쿠키 포함, 실패는 ReadingError(필드별 코드)로 */
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      headers: init.body ? { 'content-type': 'application/json' } : undefined,
    });
  } catch {
    throw new ReadingError([{ field: null, code: 'NETWORK' }]);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ReadingError(body?.errors ?? [{ field: null, code: 'SERVER_ERROR' }]);
  return body as T;
}

export const requestReading = (profile: Profile, options: Options) =>
  api<Reading>('/v1/readings', { method: 'POST', body: JSON.stringify({ profile, options }) });

// ── 사주 보관함 (로그인 필요)
export const TAGS = [
  { code: 'SELF', label: '본인' },
  { code: 'FAMILY', label: '가족' },
  { code: 'FRIEND', label: '친구' },
  { code: 'PARTNER', label: '연인' },
  { code: 'OTHER', label: '기타' },
] as const;
export type Tag = (typeof TAGS)[number]['code'];
export const tagLabel = (code: string | null) => TAGS.find(t => t.code === code)?.label;

export type ArchivedProfile = Profile & {
  profileId: string; options: Options; tag: Tag | null; isPrimary: boolean; createdAt: string;
  dayPillar: string; currentDaewoon: string | null; thisYearSeun: string;
};
export const updateProfile = (profileId: string, patch: { tag?: Tag | null; isPrimary?: boolean }) =>
  api<{ profile: ArchivedProfile }>(`/v1/profiles/${encodeURIComponent(profileId)}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const listProfiles = () => api<{ limit: number; profiles: ArchivedProfile[] }>('/v1/profiles');
/** 같은 사주인가: 서버의 중복 판단(input_hash)과 같은 항목으로 비교 (계산 방식은 제외) */
export const sameSaju = (a: Profile, b: Profile) =>
  (a.name ?? '').trim() === (b.name ?? '').trim() && a.gender === b.gender && a.calendar === b.calendar
  && !!a.isLeapMonth === !!b.isLeapMonth && a.birthDate === b.birthDate
  && (a.birthTime ?? null) === (b.birthTime ?? null) && (a.regionCode ?? '11') === (b.regionCode ?? '11');
export const saveProfile = (profile: Profile, options: Options) =>
  api<{ created: boolean; profile: ArchivedProfile }>('/v1/profiles', { method: 'POST', body: JSON.stringify({ profile, options }) });
// 비회원 결과를 로그인 뒤 보관함으로 옮기기: 로그인 도중 브라우저가 바뀌어도(카카오톡 → Chrome) 이어지게 서버에 30분 맡긴다
export const createPendingSave = (profile: Profile, options: Options) =>
  api<{ token: string }>('/v1/pending-saves', { method: 'POST', body: JSON.stringify({ profile, options }) });
export const claimPendingSave = (token: string) =>
  api<{ result: 'created' | 'existing' | 'full'; saved: Saved }>(`/v1/pending-saves/${encodeURIComponent(token)}/claim`, { method: 'POST' });
export const openProfile = (profileId: string) =>
  api<{ profile: Profile; options: Options; reading: Reading }>(`/v1/profiles/${encodeURIComponent(profileId)}`);
// 공유 링크 (PRD §7.3): 회원이 보관함 사주로 만들고, 받은 사람은 로그인 없이 연다. 30일 뒤 만료
export type Shared = { profile: Profile; options: Options; hideBirth: boolean; expiresAt: string; reading: Reading };
export const createShare = (profileId: string, hideBirth: boolean) =>
  api<{ token: string; expiresAt: string }>(`/v1/profiles/${encodeURIComponent(profileId)}/share`, { method: 'POST', body: JSON.stringify({ hideBirth }) });
export const openShare = (token: string) => api<Shared>(`/v1/share/${encodeURIComponent(token)}`);
export const deleteProfile = (profileId: string) =>
  api<void>(`/v1/profiles/${encodeURIComponent(profileId)}`, { method: 'DELETE' });

// ── 궁합. 서버에 저장하지 않고, 고르던 두 사람과 마지막 결과만 기기에 둔다
export type Relation = 'PARTNER' | 'FAMILY' | 'FRIEND';
export const RELATIONS: { value: Relation; label: string }[] = [
  { value: 'PARTNER', label: '연인' }, { value: 'FAMILY', label: '가족' }, { value: 'FRIEND', label: '친구 · 동료' },
];
/** 보관함 태그로 관계를 짐작한다 (본인 · 기타 · 없음은 짐작하지 않음) */
export const relationOfTag = (tag: string | null): Relation | undefined =>
  tag === 'PARTNER' || tag === 'FAMILY' || tag === 'FRIEND' ? tag : undefined;
export type Person = { profile: Profile; options: Options };
export const personOf = (p: Profile & { options: Options }): Person => ({
  profile: { name: p.name, gender: p.gender, calendar: p.calendar, isLeapMonth: p.isLeapMonth, birthDate: p.birthDate, birthTime: p.birthTime, regionCode: p.regionCode },
  options: p.options,
});
export type MatchResult = {
  relation: Relation;
  a: Omit<Reading, 'report'>;
  b: Omit<Reading, 'report'>;
  match: { score: number; band: string; points: { label: string; tone: 'good' | 'care' }[] };
  report: Reading['report'];
};
export const requestMatch = (a: Person, b: Person, relation: Relation) =>
  api<MatchResult>('/v1/matches', { method: 'POST', body: JSON.stringify({ a, b, relation }) });

export type MatchDraft = { a?: Person; b?: Person; relation: Relation };
export type SavedMatch = { a: Person; b: Person; result: MatchResult };
const DRAFT_KEY = 'saju.matchDraft';
const MATCH_KEY = 'saju.lastMatch';
async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export const loadMatchDraft = async (): Promise<MatchDraft> => (await readJson<MatchDraft>(DRAFT_KEY)) ?? { relation: 'PARTNER' };
export const saveMatchDraft = (draft: MatchDraft) => AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
export const loadMatch = () => readJson<SavedMatch>(MATCH_KEY);
export const saveMatch = (saved: SavedMatch) => AsyncStorage.setItem(MATCH_KEY, JSON.stringify(saved));

/** 서울 기준 오늘 날짜 YYYY-MM-DD. 기기에 저장된 결과의 오늘의 운세가 지난 날짜인지 판단할 때 쓴다 */
export const seoulToday = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

// 비회원은 기기에 최근 1건만 보관 (PRD §3.3)
const LAST_KEY = 'saju.lastReading';
export const saveLast = (saved: Saved) => AsyncStorage.setItem(LAST_KEY, JSON.stringify(saved));
/** 기기에 남은 결과 · 궁합 삭제: 비회원으로 새로 시작할 때 · 로그아웃할 때 (공용 기기에서 앞사람 정보가 남지 않게) */
export const clearLast = () => AsyncStorage.multiRemove([LAST_KEY, DRAFT_KEY, MATCH_KEY]).catch(() => {});
export async function loadLast(): Promise<Saved | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ── 입력 검증 (PRD §7.1). 최종 판정은 서버가 하고, 여기서는 입력 중 안내만 한다
const klc = new KoreanLunarCalendar();
const RANGE_ERROR = '1900년 1월 1일부터 오늘까지 입력할 수 있습니다.';

function lunarToSolar(y: number, m: number, d: number, leap: boolean): [number, number, number] | null {
  if (!klc.setLunarDate(y, m, d, leap)) return null;
  const s = klc.getSolarCalendar();
  klc.setSolarDate(s.year, s.month, s.day);
  const back = klc.getLunarCalendar();
  return back.year === y && back.month === m && back.day === d && back.intercalation === leap ? [s.year, s.month, s.day] : null;
}

export const hasLeapMonth = (y: number, m: number) => y >= 1900 && m >= 1 && m <= 12 && klc.setLunarDate(y, m, 1, true);

/** digits: YYYYMMDD 8자리 */
export function checkDate(calendar: Profile['calendar'], leap: boolean, digits: string): { code?: string; error?: string; converted?: string } {
  const y = +digits.slice(0, 4);
  const m = +digits.slice(4, 6);
  const d = +digits.slice(6, 8);
  const notExist = { code: 'DATE_NOT_EXIST', error: '존재하지 않는 날짜입니다.' };
  if (y < 1900) return { code: 'DATE_OUT_OF_RANGE', error: RANGE_ERROR };
  if (m < 1 || m > 12 || d < 1) return notExist;

  let solar: [number, number, number];
  if (calendar === 'SOLAR') {
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (d > days) return { code: 'DATE_NOT_EXIST', error: `${y}년 ${m}월은 ${days}일까지 있습니다.` };
    solar = [y, m, d];
  } else {
    if (leap && !hasLeapMonth(y, m)) return { code: 'LEAP_MONTH_NOT_EXIST', error: `${y}년에는 윤${m}월이 없습니다. 평달로 바꿔 주세요.` };
    const s = lunarToSolar(y, m, d, leap);
    if (!s) {
      return d === 30 && lunarToSolar(y, m, 29, leap)
        ? { code: 'DATE_NOT_EXIST', error: `음력 ${y}년 ${leap ? '윤' : ''}${m}월은 29일까지 있습니다.` }
        : notExist;
    }
    solar = s;
  }

  const today = new Date();
  const t = Date.UTC(solar[0], solar[1] - 1, solar[2]);
  if (t > Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) return { code: 'DATE_OUT_OF_RANGE', error: RANGE_ERROR };

  if (calendar === 'LUNAR') return { converted: `양력 ${solar[0]}년 ${solar[1]}월 ${solar[2]}일` };
  klc.setSolarDate(y, m, d);
  const l = klc.getLunarCalendar();
  return { converted: `음력 ${l.year}년 ${l.month}월 ${l.day}일${l.intercalation ? ' (윤달)' : ''}` };
}

/** digits: HHMM 4자리 */
export const checkTime = (digits: string) =>
  +digits.slice(0, 2) > 23 || +digits.slice(2, 4) > 59 ? '00:00부터 23:59 사이로 입력해 주세요.' : undefined;

// ── 지역 · 12지시
const REGION_NAMES: Record<string, string> = {
  '11': '서울특별시', '26': '부산광역시', '27': '대구광역시', '28': '인천광역시', '29': '광주광역시',
  '30': '대전광역시', '31': '울산광역시', '36': '세종특별자치시', '41': '경기도', '51': '강원특별자치도',
  '43': '충청북도', '44': '충청남도', '52': '전북특별자치도', '46': '전라남도', '47': '경상북도',
  '48': '경상남도', '50': '제주특별자치도',
};
export const REGIONS = Object.entries(REGION_NAMES).map(([code, name]) => ({ code, name }));
export const regionName = (code: string) => REGION_NAMES[code] ?? code;

/** 현행 KST(동경 135°) 대비 경도 보정(분). 서울 −32 */
export const correctionMin = (code: string) => Math.round(REGION_LON[code] * 4 - 540);
export const formatMin = (m: number) => `${m < 0 ? '−' : '+'}${Math.abs(m)}분`;

const mod = (a: number, n: number) => ((a % n) + n) % n;
const hhmm = (min: number) => `${String(Math.floor(mod(min, 1440) / 60)).padStart(2, '0')}:${String(mod(min, 1440) % 60).padStart(2, '0')}`;

/** 12지시 구간(벽시계 기준). 보정이 −32분이면 자시는 23:32–01:31 */
export const hourSlots = (correction: number) =>
  BRANCHES.map((b, i) => {
    const start = 23 * 60 + i * 120 - correction;
    return { label: `${LABELS[b]}시`, hanja: BRANCH_HANJA[i], range: `${hhmm(start)}–${hhmm(start + 119)}`, center: hhmm(start + 60) };
  });

// ── 결과 화면 표시용
export const stemInfo = (code: string) => {
  const i = STEMS.indexOf(code);
  return { hanja: STEM_HANJA[i], ko: LABELS[code], element: ELEMENTS[Math.floor(i / 2)], yang: i % 2 === 0 };
};
/** 지지의 음양은 십성 판정과 같이 정기 기준 */
export const branchInfo = (code: string) => {
  const i = BRANCHES.indexOf(code);
  return { hanja: BRANCH_HANJA[i], ko: LABELS[code], element: ELEMENTS[BRANCH_ELEMENT[i]], yang: HIDDEN[i].at(-1)![0] % 2 === 0 };
};
const ZODIAC = ['쥐', '소', '호랑이', '토끼', '용', '뱀', '말', '양', '원숭이', '닭', '개', '돼지'];
export const zodiac = (branchCode: string) => ZODIAC[BRANCHES.indexOf(branchCode)];
