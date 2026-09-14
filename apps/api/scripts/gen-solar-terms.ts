// 12절 절입 시각 테이블 생성. 한 번 실행해 data/solar_terms.json을 커밋한다.
// KASI 공표 절입시각과 1분 넘게 다른 값이 발견되면 KASI 값으로 교체한다 (PRD §4.8).
import fs from 'node:fs';
import * as Astronomy from 'astronomy-engine';

// [태양 황경°, 월지 idx, 대략적인 월, 일]
const JEOL = [
  [285, 1, 1, 6], [315, 2, 2, 4], [345, 3, 3, 6], [15, 4, 4, 5], [45, 5, 5, 6], [75, 6, 6, 6],
  [105, 7, 7, 7], [135, 8, 8, 8], [165, 9, 9, 8], [195, 10, 10, 8], [225, 11, 11, 7], [255, 0, 12, 7],
];

// 1900-01 출생의 직전 절(1899 대설)과 2050 출생의 다음 절까지 덮도록 앞뒤 1년 여유
const terms: [number, number][] = [];
for (let y = 1899; y <= 2101; y++) {
  for (const [lon, branch, m, d] of JEOL) {
    const t = Astronomy.SearchSunLongitude(lon, new Date(Date.UTC(y, m - 1, d - 10)), 20);
    if (!t) throw new Error(`절기 탐색 실패: ${y} ${lon}°`);
    terms.push([Math.round(t.date.getTime() / 60_000) * 60_000, branch]); // 분 단위 반올림
  }
}

const out = new URL('../data/solar_terms.json', import.meta.url);
fs.mkdirSync(new URL('.', out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(terms));
console.log(`solar_terms.json: ${terms.length} terms`);
