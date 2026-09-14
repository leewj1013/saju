// API 서버 (PRD §6). 첫 슬라이스: 비회원이 입력 → 계산 + 해석을 한 번에 받는 흐름.
// DB 저장 · 로그인 · 보관함 · 공유 · PDF는 다음 슬라이스에서 붙인다.
import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { calculate, SajuInputError } from './engine/index.ts';
import type { SajuInput, SajuOptions } from './engine/index.ts';
import { buildMatchReport, buildReport } from './rules/engine.ts';
import { RELATIONS } from './engine/match.ts';
import type { Relation } from './engine/match.ts';
import type { RuleSet } from './rules/engine.ts';
import { loadRuleSet, validateRuleSet } from './rules/authoring.ts';
import { loadPublishedRuleSet, publishRuleSet, versionOf } from './rules/store.ts';
import { openDb } from './db.ts';
import fastifyCookie from '@fastify/cookie';
import type { DatabaseSync } from 'node:sqlite';
import { registerGoogleAuth } from './auth.ts';
import type { GoogleConfig } from './auth.ts';
import { registerProfiles } from './profiles.ts';
import { webHead } from './web-head.ts';

const READING_BODY = {
  type: 'object',
  required: ['profile', 'options'],
  properties: {
    profile: {
      type: 'object',
      required: ['gender', 'calendar', 'birthDate', 'birthTime'],
      properties: {
        name: { type: 'string', maxLength: 12 },
        gender: { type: 'string', maxLength: 1 },
        calendar: { type: 'string', maxLength: 5 },
        isLeapMonth: { type: 'boolean' },
        birthDate: { type: 'string', maxLength: 10 },
        birthTime: { type: ['string', 'null'], maxLength: 5 },
        regionCode: { type: 'string', maxLength: 4 },
      },
    },
    options: {
      type: 'object',
      required: ['jasiMode', 'longitudeCorrection'],
      properties: { jasiMode: { type: 'string', maxLength: 10 }, longitudeCorrection: { type: 'boolean' } },
    },
  },
};

// 궁합: 두 사람의 입력(결과 요청과 같은 모양) + 관계
const MATCH_BODY = {
  type: 'object',
  required: ['a', 'b', 'relation'],
  properties: { a: READING_BODY, b: READING_BODY, relation: { type: 'string', enum: RELATIONS } },
};

// 계측 이벤트 (PRD §8). 허용한 속성만 남기고 개인정보는 받지 않는다. 기능이 붙을 때 이벤트를 추가한다
const EVENT_PROPS: Record<string, string[]> = {
  input_start: [],
  input_error: ['field', 'code'],
  input_submit: ['calendar', 'hourKnown'],
  result_view: ['source'],
  tab_view: ['category'],
  save: ['created', 'afterLogin'],
  share: ['channel', 'hideBirth'],
  match_submit: ['relation'],
  match_view: ['relation'],
};

const EVENT_BODY = {
  type: 'object',
  required: ['sessionId', 'name'],
  properties: {
    sessionId: { type: 'string', maxLength: 40 },
    name: { type: 'string', enum: Object.keys(EVENT_PROPS) },
    props: { type: 'object', maxProperties: 5 },
  },
};

/**
 * 로그에 남기지 않을 값: 로그인 콜백의 인가 코드 · state, 로그인 시작의 돌아올 주소, 맡긴 결과를 가져가는 토큰.
 * 토큰은 로그인 뒤 돌아올 주소(/result?claim=…)에도 실려 오므로 경로 · 쿼리 모두 가린다
 */
export function redactUrl(url: string) {
  if (url.startsWith('/v1/pending-saves/')) return '/v1/pending-saves/[생략]/claim';
  if (url.startsWith('/v1/auth/google/') || url.includes('claim=')) return `${url.split('?')[0]}?[생략]`;
  return url;
}

export function cleanEventProps(name: string, props: Record<string, unknown> = {}) {
  return Object.fromEntries(
    (EVENT_PROPS[name] ?? [])
      .filter(k => typeof props[k] === 'boolean' || typeof props[k] === 'number' || (typeof props[k] === 'string' && (props[k] as string).length <= 40))
      .map(k => [k, props[k]]),
  );
}

type ServerOptions = {
  ruleSet: RuleSet;
  allowOrigin?: string;          // 웹을 다른 도메인에서 띄울 때만. 같은 도메인 배포면 비워 둔다
  webRoot?: string;              // Expo 웹 빌드(dist) 경로. 주면 API와 같은 도메인에서 웹도 서비스
  proxyHops?: number;            // 앞단 프록시(로드밸런서) 수. 요청 제한용 사용자 IP를 X-Forwarded-For 오른쪽에서 읽는다
  noindex?: boolean;             // 베타: 검색 엔진 수집 막기
  publicUrl?: string;            // PUBLIC_URL. 링크 미리보기 이미지 주소의 기준
  db?: DatabaseSync;             // 로그인 · 저장 기능에 필요
  google?: GoogleConfig;         // 주면 Google 로그인을 켠다
  dataKey?: string;              // DATA_ENCRYPTION_KEY. 로그인과 함께 주면 사주 보관함을 켠다
  rateLimitPerMin?: number;
  eventsPerMin?: number;
  now?: () => number;
  logger?: boolean;
};

export function buildServer({
  ruleSet, allowOrigin, webRoot, proxyHops = 0, noindex = false, publicUrl, db, google, dataKey,
  rateLimitPerMin = 20, eventsPerMin = 120, now = Date.now, logger = false,
}: ServerOptions) {
  // 기본 로거는 요청 본문(생년월일시)을 남기지 않는다. 로그인 콜백 주소의 인가 코드 · state도 남기지 않는다
  const app = Fastify({
    logger: logger && {
      serializers: {
        req: req => ({
          method: req.method,
          url: redactUrl(req.url),
          host: req.headers.host,
          remoteAddress: req.ip,
        }),
      },
    },
  });

  // Fastify trustProxy는 쓰지 않는다: 숫자 값은 X-Forwarded-For를 읽지 않았고, true는 클라이언트가
  // 위조할 수 있는 맨 왼쪽 주소를 쓴다. 로드밸런서가 끝에 붙인 주소를 오른쪽에서 proxyHops번째로 읽는다
  const clientIp = (req: FastifyRequest) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (!proxyHops || typeof forwarded !== 'string') return req.ip;
    const chain = forwarded.split(',').map(s => s.trim()).filter(Boolean);
    return chain[chain.length - proxyHops] ?? req.ip;
  };

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-Frame-Options', 'DENY');
    if (noindex) reply.header('X-Robots-Tag', 'noindex, nofollow');
    if (!allowOrigin) return;
    reply.header('Access-Control-Allow-Origin', allowOrigin);
    reply.header('Access-Control-Allow-Credentials', 'true'); // 개발: 8081 웹이 3000 API에 로그인 쿠키를 보내도록
    reply.header('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'content-type');
      reply.header('Access-Control-Max-Age', '600');
      return reply.code(204).send();
    }
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err.validation) return reply.code(400).send({ errors: [{ field: null, code: 'BODY_INVALID' }] });
    app.log.error(err);
    return reply.code(500).send({ errors: [{ field: null, code: 'SERVER_ERROR' }] });
  });

  // ponytail: 인스턴스 메모리 카운터. 서버를 여러 대 띄우면 공용 저장소로 옮긴다
  const limiter = (perMin: number) => {
    const hits = new Map<string, { windowStart: number; count: number }>();
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const t = now();
      if (hits.size > 10_000) for (const [ip, h] of hits) if (t - h.windowStart >= 60_000) hits.delete(ip);
      const ip = clientIp(req);
      const h = hits.get(ip);
      if (!h || t - h.windowStart >= 60_000) {
        hits.set(ip, { windowStart: t, count: 1 });
        return;
      }
      if (++h.count > perMin) {
        reply.header('Retry-After', String(Math.ceil((h.windowStart + 60_000 - t) / 1000)));
        return reply.code(429).send({ errors: [{ field: null, code: 'RATE_LIMITED' }] });
      }
    };
  };

  app.get('/health', async () => ({ ok: true, ruleSetVersion: ruleSet.version }));

  let auth: ReturnType<typeof registerGoogleAuth> | undefined;
  if (google) {
    if (!db) throw new Error('Google 로그인에는 db가 필요합니다');
    app.register(fastifyCookie, { secret: google.cookieSecret });
    auth = registerGoogleAuth(app, { ...google, db, webOrigin: allowOrigin, now });
  }

  // 이벤트는 로그 한 줄로 남긴다 (scripts/metrics.ts가 집계). 분석 도구를 정하면 여기서 전달한다
  app.post('/v1/events', { schema: { body: EVENT_BODY }, preHandler: limiter(eventsPerMin) }, async (req, reply) => {
    const { sessionId, name, props } = req.body as { sessionId: string; name: string; props?: Record<string, unknown> };
    req.log.info({ event: name, sessionId, props: cleanEventProps(name, props) }, 'event');
    return reply.code(204).send();
  });

  // 룰 코드 · 우선순위는 내보내지 않는다 (PRD §6)
  const publicReport = (report: ReturnType<typeof buildReport>) => ({
    ruleSetVersion: report.ruleSetVersion,
    categories: report.categories.map(c => ({
      category: c.category,
      title: c.title,
      sections: c.sections
        .filter(s => s.items.length)
        .map(s => ({ section: s.section, title: s.title, items: s.items.map(({ title, text }) => ({ title, text })) })),
    })),
  });

  // 계산 + 해석 응답. 입력이 틀리면 SajuInputError를 던진다 (새 결과 · 보관함 열기 공용)
  const buildReading = (profile: SajuInput & { name?: string }, options: SajuOptions) => {
    const { chart, converted, notices } = calculate(profile, options, now());
    return { converted, notices, chart, report: publicReport(buildReport(chart, ruleSet, profile.name?.trim())) };
  };

  type Person = { profile: SajuInput & { name?: string }; options: SajuOptions };
  // 입력 오류는 누구의 칸인지 알 수 있게 필드 앞에 a. · b. 를 붙인다
  const calculateFor = (side: 'a' | 'b', { profile, options }: Person) => {
    try {
      return calculate(profile, options, now());
    } catch (e) {
      if (e instanceof SajuInputError) throw new SajuInputError(e.errors.map(err => ({ ...err, field: `${side}.${err.field}` })));
      throw e;
    }
  };

  app.post('/v1/readings', { schema: { body: READING_BODY }, preHandler: limiter(rateLimitPerMin) }, async (req, reply) => {
    const { profile, options } = req.body as { profile: SajuInput & { name?: string }; options: SajuOptions };
    try {
      return buildReading(profile, options);
    } catch (e) {
      if (e instanceof SajuInputError) return reply.code(400).send({ errors: e.errors });
      throw e;
    }
  });

  // 궁합 (비회원도 가능, 서버에 저장하지 않음). 두 사람 모두 틀렸으면 둘 다 알려 준다
  app.post('/v1/matches', { schema: { body: MATCH_BODY }, preHandler: limiter(rateLimitPerMin) }, async (req, reply) => {
    const { a, b, relation } = req.body as { a: Person; b: Person; relation: Relation };
    const results = (['a', 'b'] as const).map(side => {
      try {
        return calculateFor(side, side === 'a' ? a : b);
      } catch (e) {
        if (e instanceof SajuInputError) return e;
        throw e;
      }
    });
    const errors = results.flatMap(r => (r instanceof SajuInputError ? r.errors : []));
    if (errors.length) return reply.code(400).send({ errors });

    const [ra, rb] = results as ReturnType<typeof calculate>[];
    const report = buildMatchReport(ra.chart, rb.chart, ruleSet, relation, { a: a.profile.name?.trim(), b: b.profile.name?.trim() });
    return {
      relation,
      a: { converted: ra.converted, notices: ra.notices, chart: ra.chart },
      b: { converted: rb.converted, notices: rb.notices, chart: rb.chart },
      match: report.match,
      report: publicReport(report),
    };
  });

  if (auth && dataKey) {
    registerProfiles(app, { db: db!, dataKey, userIdOf: auth.userIdOf, buildReading, bodySchema: READING_BODY, guestLimiter: limiter(rateLimitPerMin), now });
  }

  if (webRoot) {
    const indexHtml = webHead(fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8'), publicUrl);
    // 파일명에 해시가 붙는 번들은 오래 캐시하고, index.html은 배포 즉시 바뀌도록 매번 확인
    app.register(fastifyStatic, {
      root: webRoot,
      index: false, // 원본 index.html 대신 head를 채운 indexHtml을 보낸다 (아래 NotFound 처리)
      allowedPath: (pathName: string) => pathName !== '/index.html',
      // @fastify/static v10은 Node 응답 객체가 아니라 Fastify reply를 넘긴다
      setHeaders: (reply: FastifyReply, filePath: string) => {
        const hashed = filePath.includes(`${path.sep}_expo${path.sep}static${path.sep}`);
        reply.header('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    const sendIndex = (reply: FastifyReply) => reply.header('Cache-Control', 'no-cache').type('text/html; charset=utf-8').send(indexHtml);
    app.get('/', (req, reply) => sendIndex(reply)); // index: false라 정적 처리기는 /를 폴더 접근(403)으로 거절한다
    // /result 같은 앱 경로를 새로고침해도 웹 앱이 뜨도록 index.html로 보낸다.
    // Accept 헤더로 거르지 않는다: 카카오톡 · 페이스북 미리보기 수집기는 Accept: */* 로 와서 미리보기 정보를 못 읽었다.
    // 확장자가 있는 경로(없는 이미지 · 번들 파일)는 HTML 대신 404
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/v1/') && !/\.\w+$/.test(req.url.split('?')[0])) {
        if (req.url.startsWith('/s/')) reply.header('X-Robots-Tag', 'noindex, nofollow'); // 공유 결과는 검색에 노출하지 않는다
        return sendIndex(reply);
      }
      return reply.code(404).send({ errors: [{ field: null, code: 'NOT_FOUND' }] });
    });
  }

  return app;
}

if (import.meta.main) {
  const env = process.env;

  // 콘텐츠 CSV를 검증하고, 내용이 바뀌었으면 새 버전으로 DB에 저장 · 발행한 뒤 발행본으로 서비스한다
  const content = loadRuleSet(path.resolve(import.meta.dirname, '../content'), '');
  const errors = [...content.problems, ...validateRuleSet(content.ruleSet)];
  if (errors.length) throw new Error(`룰 세트 검증 실패\n${errors.join('\n')}`);

  const dbPath = env.DATABASE_PATH ? path.resolve(env.DATABASE_PATH) : path.resolve(import.meta.dirname, '../var/saju.db');
  const dbExisted = fs.existsSync(dbPath);
  const db = openDb(dbPath);
  // 배포에서 시작할 때마다 "새로 만듦"이면 영구 디스크가 연결되지 않은 것: 재배포 · 재시작마다 로그인 · 보관함이 사라진다
  const { n: users } = db.prepare('SELECT COUNT(*) AS n FROM app_user').get() as { n: number };
  console.log(`DB ${dbPath}: ${dbExisted ? '기존 파일 사용' : '새로 만듦'} · 사용자 ${users}명`);
  publishRuleSet(db, { ...content.ruleSet, version: versionOf(content.ruleSet) });
  const ruleSet = loadPublishedRuleSet(db)!;
  const production = env.NODE_ENV === 'production';
  const publicUrl = env.PUBLIC_URL ?? (production ? undefined : `http://localhost:${env.PORT ?? 3000}`);
  let google: GoogleConfig | undefined;
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.AUTH_SECRET) {
    if (env.AUTH_SECRET.length < 32) throw new Error('AUTH_SECRET은 32자 이상 무작위 값이어야 합니다');
    // Google Console "승인된 리디렉션 URI" = PUBLIC_URL + /v1/auth/google/callback
    if (!publicUrl) throw new Error('PUBLIC_URL을 설정하세요 (예: https://beta.example.com)');
    google = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, cookieSecret: env.AUTH_SECRET, publicUrl };
    if (!env.DATA_ENCRYPTION_KEY) console.warn('사주 보관함 꺼짐: DATA_ENCRYPTION_KEY가 비어 있습니다');
  } else {
    console.warn('Google 로그인 꺼짐: GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET · AUTH_SECRET 중 비어 있는 값이 있습니다');
  }

  const app = buildServer({
    ruleSet,
    db,
    google,
    dataKey: google ? env.DATA_ENCRYPTION_KEY : undefined,
    allowOrigin: env.CORS_ORIGIN ?? (production ? undefined : 'http://localhost:8081'),
    webRoot: env.WEB_ROOT ? path.resolve(env.WEB_ROOT) : undefined,
    // 프록시 뒤가 아닌데 켜면 X-Forwarded-For 위조로 요청 제한을 우회할 수 있다
    proxyHops: Number(env.PROXY_HOPS ?? 0),
    noindex: env.ROBOTS_NOINDEX === 'true',
    publicUrl,
    logger: true,
  });
  await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
}
