# Railway 배포 (사용자 테스트용)

서버 · 도메인 없이 시작하는 구성입니다. Railway 한 곳에 컨테이너 하나(웹 + API)를 올리고, SQLite DB는 Railway 영구 디스크(Volume)에 둡니다. 코드 변경 없이 저장소 루트의 `Dockerfile` · `railway.json`으로 배포됩니다. 주소는 Railway가 무료로 주는 `https://<이름>.up.railway.app`을 씁니다.

비용: Railway Hobby 요금제 월 5달러(사용량 5달러 포함, 이 서비스 규모면 추가 비용 거의 없음). 가입 시 체험 크레딧으로 먼저 써 볼 수 있습니다. 요금은 railway.com/pricing에서 확인하세요.

## 1. GitHub에 올리기 (비공개 저장소)

1. github.com → New repository → 이름 `saju-project`, **Private** 선택 → 만들기 (README 추가하지 않음)
2. 프로젝트 루트에서:

```bash
git init
```
```bash
git add .
```
```bash
git status
```

`git status` 목록에 **`.env`, `.env.production`, `apps/api/var/`가 없는지** 확인합니다 (루트 `.gitignore`가 막음). 있으면 커밋하지 말고 멈추세요.

```bash
git commit -m "웹 베타 첫 배포"
```
```bash
git branch -M main
```
```bash
git remote add origin https://github.com/<내 계정>/saju-project.git
```
```bash
git push -u origin main
```

## 2. Railway 서비스 만들기

1. railway.com → GitHub 계정으로 로그인
2. **New Project → Deploy from GitHub repo → `saju-project`** 선택. 첫 빌드가 시작됩니다 (3~5분, 이 단계에서는 실패해도 괜찮음)
3. 서비스 화면 → **Settings → Networking → Generate Domain** → 나온 주소(예: `saju-project-production.up.railway.app`)를 적어 둡니다
4. 서비스 우클릭(또는 Command+K) → **Add Volume** → Mount path **`/data`**
5. **Variables** 탭 → Raw Editor에 붙여 넣고 값 채우기:

```text
PUBLIC_URL=https://<3에서 받은 주소>
PROXY_HOPS=1
ROBOTS_NOINDEX=true
RAILWAY_RUN_UID=0
GOOGLE_CLIENT_ID=<apps/api/.env와 같은 값>
GOOGLE_CLIENT_SECRET=<apps/api/.env와 같은 값>
AUTH_SECRET=<apps/api/.env.production 값>
DATA_ENCRYPTION_KEY=<apps/api/.env.production 값>
```

- `RAILWAY_RUN_UID=0`: 컨테이너가 Volume(`/data`)에 DB 파일을 쓸 수 있게 합니다. 빠지면 서버가 "unable to open database file"로 멈춥니다.
- `apps/api/.env.production`: 운영용 키를 미리 만들어 둔 파일입니다 (Git에 올라가지 않음). `DATA_ENCRYPTION_KEY`는 한 번 넣으면 바꾸지 마세요 — 바꾸면 저장된 보관함을 읽을 수 없습니다.
- 변수를 저장하면 자동으로 다시 배포됩니다.

## 3. Google 로그인 연결

Google Cloud Console → API 및 서비스 → 사용자 인증 정보 → 쓰던 OAuth 클라이언트:

- **승인된 리디렉션 URI**에 `https://<Railway 주소>/v1/auth/google/callback` 추가 (localhost 주소는 그대로 둠)

OAuth 동의 화면(Google 인증 플랫폼 → 대상):

- 게시 상태가 **테스트**면 등록한 테스트 사용자만 로그인됩니다. 테스터 이메일을 "테스트 사용자"에 추가하거나, **앱 게시(프로덕션)** 로 바꿉니다. 이 서비스는 `openid` 권한만 쓰므로 Google 검수 없이 게시할 수 있습니다.

## 4. 확인

- [ ] `https://<주소>/health` → `{"ok":true,"ruleSetVersion":"content-…"}`
- [ ] 첫 화면 → 비회원 로그인 → 입력 → 결과, 새로고침해도 유지
- [ ] Google 로그인 → 보관함 저장 → 공유 링크를 시크릿 창에서 열기
- [ ] Railway에서 **Redeploy** 한 뒤에도 보관함 사주가 남아 있음 (= Volume 정상)
- [ ] 휴대폰으로 접속, 카카오톡으로 주소를 보내 미리보기 확인
- [ ] 같은 기기에서 1분에 21번째 결과 요청 → "요청이 많습니다", 다른 기기는 영향 없음 (아니면 `PROXY_HOPS` 조정)

## 이후 수정 배포

코드를 고친 뒤 `git add .` → `git commit -m "…"` → `git push` 하면 Railway가 자동으로 다시 배포합니다. DB는 Volume에 남습니다.

베타 지표: Railway 서비스 → Logs에서 로그를 내려받아 `npm --prefix apps/api run metrics -- 내려받은-로그.log`.
