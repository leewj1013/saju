// 웹 빌드 index.html의 head: 서버가 WEB_ROOT로 웹을 함께 서비스할 때 채워 넣는다

// 링크 미리보기(카카오톡 등) · 검색 결과 · 홈 화면에 추가할 때 쓰이는 정보
const SITE_TITLE = '사주 四柱 — 만세력 사주 풀이';
const SITE_DESCRIPTION = '생년월일시로 사주팔자를 세우고 오늘의 운세, 총운, 기본 성향, 재물·직업·연애운, 대운 흐름을 풀어 드립니다.';

/** Expo 웹 빌드의 index.html(기본 템플릿: lang="en", 제목만 있음)에 한국어 · 미리보기 · 앱 설치 정보를 넣는다 */
export function webHead(html: string, publicUrl = '') {
  const base = publicUrl.replace(/\/$/, ''); // 미리보기 이미지는 절대 주소여야 카카오톡 · 페이스북이 읽는다
  const head = [
    `<title>${SITE_TITLE}</title>`,
    `<meta name="description" content="${SITE_DESCRIPTION}" />`,
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="사주 四柱" />',
    '<meta property="og:locale" content="ko_KR" />',
    `<meta property="og:title" content="${SITE_TITLE}" />`,
    `<meta property="og:description" content="${SITE_DESCRIPTION}" />`,
    base && `<meta property="og:url" content="${base}/" />`,
    `<meta property="og:image" content="${base}/og.jpg" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    '<meta name="theme-color" content="#FEFEFE" />',
    '<link rel="manifest" href="/manifest.webmanifest" />',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
    '<meta name="apple-mobile-web-app-title" content="사주" />',
  ].filter(Boolean).join('\n    ');
  return html.replace('<html lang="en">', '<html lang="ko">').replace(/<title>[^<]*<\/title>/, head);
}
