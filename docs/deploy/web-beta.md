# 웹 베타 배포

컨테이너 하나가 웹 앱(Expo 웹 빌드)과 API를 **같은 도메인**에서 서비스합니다. Dockerfile을 지원하는 호스팅이면 어디든 올릴 수 있습니다. Railway에 올리는 순서는 [railway.md](railway.md).

```text
사용자 ─ HTTPS ─ 호스팅 로드밸런서 ─ 컨테이너 :3000
                                     ├─ /            웹 앱 (index.html, /result 새로고침 포함)
                                     ├─ /_expo/...   번들 (1년 캐시)
                                     ├─ /v1/*        API
                                     └─ /health      헬스 체크
```

## 1. 배포 전 로컬 확인

Docker가 없어도 배포 이미지와 같은 모드로 돌려볼 수 있습니다. 프로젝트 루트에서:

```bash
npx --prefix apps/mobile expo export --platform web --output-dir dist
```
```bash
node --env-file-if-exists=apps/api/.env --env-file=apps/api/beta-local.env apps/api/src/server.ts
```

`http://localhost:3200`에서 입력 → 결과까지 확인합니다. 여기서 Google 로그인까지 확인하려면 Google Console 리디렉션 URI에 `http://localhost:3200/v1/auth/google/callback`도 등록해 두세요 (개발 서버용 `http://localhost:3000/v1/auth/google/callback`과 함께). Docker가 있으면 `docker build -t saju-web .` 후 `docker run -p 3000:3000 saju-web`.

## 2. 호스팅 설정

어느 호스팅이든 설정은 같습니다.

| 항목 | 값 |
|---|---|
| 빌드 방식 | 저장소 루트의 `Dockerfile` |
| 내부 포트 | `3000` |
| 헬스 체크 경로 | `/health` |
| 인스턴스 수 | **1** — DB가 컨테이너 안의 SQLite 파일이고, 요청 제한 카운터도 서버 메모리에 있습니다 |
| 영구 디스크 | **`/data`에 연결 (1GB면 충분)** — SQLite DB 파일 위치. 연결하지 않으면 재배포할 때마다 DB가 초기화됩니다 |
| HTTPS · 도메인 | 호스팅에서 발급 (예: `beta.도메인`) |

| 환경 변수 | 베타 값 | 설명 |
|---|---|---|
| `PROXY_HOPS` | `1` | 앞단 로드밸런서 수. 호스팅 로드밸런서 뒤라면 필수 — 없으면 모든 사용자가 프록시 IP 하나로 묶여 분당 20회 제한을 함께 씁니다. 서버는 `X-Forwarded-For`의 **오른쪽에서 이 수만큼** 떨어진 주소(로드밸런서가 붙인 값)를 사용자 IP로 보므로, 사용자가 헤더 앞쪽을 위조해도 우회되지 않습니다. 프록시 없이 직접 노출할 때는 넣지 마세요. CDN을 로드밸런서 앞에 하나 더 두면 `2` |
| `PUBLIC_URL` | `https://<베타 도메인>` | Google 로그인 리디렉션 주소 · 카카오톡 링크 미리보기 이미지 주소의 기준. 배포에서 필수 (끝에 `/` 없이) |
| `ROBOTS_NOINDEX` | `true` | 베타 기간 검색 노출 막기. 정식 오픈 때 제거 |
| `CORS_ORIGIN` | (비움) | 같은 도메인이라 필요 없음. 웹을 다른 도메인에 따로 올릴 때만 그 주소 |
| `NODE_ENV` · `PORT` · `WEB_ROOT` · `DATABASE_PATH` | 이미지에 설정됨 | 바꾸지 않음 (`DATABASE_PATH=/data/saju.db`) |

해석 콘텐츠 버전은 콘텐츠 내용으로 자동으로 정해집니다(`content-<해시>`). 서버가 시작할 때 처음 보는 버전이면 DB에 저장하고 발행합니다.

**Google 로그인:** 로컬 `apps/api/.env`와 같은 이름(`GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` · `AUTH_SECRET` · `DATA_ENCRYPTION_KEY`)을 호스팅의 시크릿 설정에 넣습니다. `.env` 파일은 이미지에 들어가지 않습니다. `AUTH_SECRET` · `DATA_ENCRYPTION_KEY`는 로컬과 다른 값을 쓰고, `DATA_ENCRYPTION_KEY`는 한 번 정하면 바꾸지 마세요. 그리고 Google Cloud Console의 같은 OAuth 클라이언트에 **승인된 리디렉션 URI** `https://<베타 도메인>/v1/auth/google/callback`을 추가합니다. 셋 중 하나라도 비어 있으면 서버는 로그인 없이 뜨고 로그에 경고를 남깁니다.

## 3. 배포 후 확인

- [ ] `https://…/health` → `{"ok":true,"ruleSetVersion":"content-…"}`
- [ ] 한 번 재배포한 뒤에도 같은 버전이 유지됨 (= `/data` 영구 디스크가 연결됨)
- [ ] 첫 화면에서 입력 → 결과까지 도달, `/result`에서 새로고침해도 결과 화면 유지
- [ ] 응답 헤더에 `x-robots-tag: noindex, nofollow`
- [ ] 같은 기기에서 1분에 21번째 결과 요청 → "요청이 많습니다" 안내 (다른 기기는 영향 없음 = `PROXY_HOPS` 정상)
- [ ] 호스팅 로그에 `"msg":"event"` 줄이 쌓임

## 4. 베타 지표 보기

호스팅 대시보드에서 로그를 파일로 내려받은 뒤:

```bash
npm --prefix apps/api run metrics -- 내려받은-로그.log
```

입력 시작 → 결과 도달률, 결과 API p95, 자주 나는 입력 오류가 나옵니다.

## 베타 범위와 개인정보

- 서버는 생년월일시를 저장하지 않습니다. 계산 후 응답만 돌려주고, 로그에는 요청 본문이 남지 않습니다.
- 최근 결과 1건은 사용자 기기(브라우저 저장소)에만 남습니다.
- 이벤트에는 세션 ID(앱을 켤 때마다 새로 생성)와 허용된 속성만 담깁니다.
- 로그인 · 보관함 · 공유 링크 · PDF는 이 베타에 없습니다.
