# 웹 베타: Expo 웹 빌드와 API를 한 컨테이너 · 같은 도메인에서 서비스
# 빌드:  docker build -t saju-web .
# 실행:  docker run -p 3000:3000 -v saju-data:/data -e ROBOTS_NOINDEX=true saju-web   → http://localhost:3000
#        (/data에 SQLite DB가 저장된다. 볼륨 없이 띄우면 컨테이너를 지울 때 DB도 사라짐)
# 호스팅 설정과 환경 변수는 docs/deploy/web-beta.md, Railway 배포 순서는 docs/deploy/railway.md

# ── 1단계: 웹 빌드 (앱이 API의 코드표를 가져오므로 apps/api/src도 필요)
FROM node:24-slim AS web
WORKDIR /app
COPY apps/mobile/package.json apps/mobile/package-lock.json apps/mobile/
RUN npm ci --prefix apps/mobile
COPY apps/api/src apps/api/src
COPY apps/mobile apps/mobile
RUN cd apps/mobile && npx expo export --platform web --output-dir dist

# ── 2단계: API 런타임 (개발용 의존성 제외)
FROM node:24-slim
ENV NODE_ENV=production PORT=3000 WEB_ROOT=/app/web DATABASE_PATH=/data/saju.db
WORKDIR /app/api
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci --omit=dev
COPY apps/api/src src
COPY apps/api/db db
COPY apps/api/content content
COPY apps/api/data data
COPY --from=web /app/apps/mobile/dist /app/web
# /data는 호스팅의 영구 디스크를 연결하는 자리 (Railway는 Dockerfile의 VOLUME 명령을 허용하지 않아 대시보드에서 연결)
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "src/server.ts"]
