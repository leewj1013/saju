// 시간대 · 음양력 · 절기. 벽시계 값은 "UTC로 표기한 ms"로 다룬다 (getUTC*로 읽음).
import KoreanLunarCalendar from 'korean-lunar-calendar';
import TERMS from '../../data/solar_terms.json' with { type: 'json' };

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

const seoulFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul', hourCycle: 'h23',
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
});

/** instant의 Asia/Seoul UTC 오프셋(ms). tzdata 이력(LMT, +8:30 시기, 서머타임) 포함 */
export function seoulOffset(utc: number): number {
  const p: Record<string, string> = {};
  for (const { type, value } of seoulFmt.formatToParts(new Date(utc))) p[type] = value;
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return wall - Math.floor(utc / 1000) * 1000;
}

/** 서울 벽시계 → UTC. 서머타임 시작으로 없는 시각은 null, 두 번 있는 시각은 표준시로 해석 */
export function seoulWallToUtc(wall: number): number | null {
  // 후보 오프셋(+8:27 ~ +10:00)이 모두 이 4시간 창 안에 있으므로 창 양끝의 오프셋만 보면 된다
  const candidates = new Set([seoulOffset(wall - 11 * HOUR), seoulOffset(wall - 7 * HOUR)]);
  const valid = [...candidates].filter(o => seoulOffset(wall - o) === o);
  return valid.length ? wall - Math.min(...valid) : null;
}

/** 서머타임 여부: 같은 해 1월보다 정확히 1시간 빠르면 서머타임 (1954·1961 표준시 변경은 30분이라 제외됨) */
export function isSeoulDst(utc: number): boolean {
  const year = new Date(utc + seoulOffset(utc)).getUTCFullYear();
  return seoulOffset(utc) - seoulOffset(Date.UTC(year, 0, 15)) === HOUR;
}

const klc = new KoreanLunarCalendar();

/** 음력 → 양력 [y, m, d]. 라이브러리가 없는 날짜에도 true를 줄 수 있어 역변환으로 확인한다 */
export function lunarToSolar(y: number, m: number, d: number, leap: boolean): [number, number, number] | 'LEAP_MONTH_NOT_EXIST' | 'DATE_NOT_EXIST' {
  if (!klc.setLunarDate(y, m, d, leap)) {
    return leap && !klc.setLunarDate(y, m, 1, true) ? 'LEAP_MONTH_NOT_EXIST' : 'DATE_NOT_EXIST';
  }
  const s = klc.getSolarCalendar();
  klc.setSolarDate(s.year, s.month, s.day);
  const back = klc.getLunarCalendar();
  if (back.year !== y || back.month !== m || back.day !== d || back.intercalation !== leap) return 'DATE_NOT_EXIST';
  return [s.year, s.month, s.day];
}

export function solarToLunar(y: number, m: number, d: number): { year: number; month: number; day: number; intercalation: boolean } {
  klc.setSolarDate(y, m, d);
  return klc.getLunarCalendar();
}

/** [절입 UTC ms, 월지 idx], 시간순. scripts/gen-solar-terms.ts로 생성 */
export const terms = TERMS as [number, number][];

/** instant 이전(포함) 마지막 절 → 현재 월 */
export const lastJeol = (utc: number) => terms.findLast(t => t[0] <= utc)!;
/** instant 이후 첫 절 */
export const nextJeol = (utc: number) => terms.find(t => t[0] > utc)!;
/** 해당 연도 입춘 */
export const ipchun = (year: number) => terms.find(t => t[1] === 2 && new Date(t[0]).getUTCFullYear() === year)!;
