// 사주 보관함 (PRD §3.3 · §7.3): 로그인 사용자의 사주 저장 · 목록 · 열기 · 삭제
// 이름 · 생년월일시는 AES-256-GCM으로 암호화해 저장하고, 열 때마다 현재 발행 룰 세트로 다시 계산한다.
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { calculate, SajuInputError } from './engine/index.ts';
import type { SajuInput, SajuOptions } from './engine/index.ts';
import { LABELS } from './rules/engine.ts';
import { transaction } from './db.ts';

export const ARCHIVE_LIMIT = 50;
export const TAGS = ['SELF', 'FAMILY', 'FRIEND', 'PARTNER', 'OTHER']; // 본인 · 가족 · 친구 · 연인 · 기타

const PATCH_BODY = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: {
    tag: { type: ['string', 'null'], enum: [...TAGS, null] },
    isPrimary: { type: 'boolean' },
  },
};

const SHARE_DAYS = 30;
const SHARE_BODY = {
  type: 'object',
  required: ['hideBirth'],
  additionalProperties: false,
  properties: { hideBirth: { type: 'boolean' } },
};

type ProfileInput = SajuInput & { name?: string };
type Reading = ReturnType<typeof calculate> & { report: object };

/**
 * 공유 링크의 생년월일시 가림: 날짜 · 음력 · 출생지 보정 안내를 빼고,
 * 대운 시작 시각 · 소수점 나이처럼 출생 시각을 거꾸로 계산할 수 있는 값은 연도 · 정수로 줄인다
 */
export function hideBirth(reading: Reading) {
  const { chart } = reading;
  const dw = chart.daewoon;
  const list = dw.list.map(d => ({ ...d, fromAge: dw.number + 10 * (d.order - 1), startAt: `${d.startAt.slice(0, 4)}-07-01T00:00:00.000Z` }));
  return {
    ...reading,
    converted: null,
    notices: [],
    chart: {
      ...chart,
      meta: { ...chart.meta, correctionMin: null, dstApplied: false },
      daewoon: {
        ...dw,
        startAgeExact: dw.number,
        list,
        current: dw.current && { ...list[dw.current.order - 1], yearsToNext: Math.ceil(dw.current.yearsToNext) },
      },
    },
  };
}
type Row = {
  profile_id: string; name_enc: Uint8Array | null; birth_enc: Uint8Array;
  gender: string; region_code: string; options: string; tag: string | null; is_primary: number; created_at: string;
};

/** DATA_ENCRYPTION_KEY(32바이트)에서 용도별 키를 나눠 만든다: 암호화용 · 중복 확인용 */
export function profileKeys(secret: string) {
  const master = Buffer.from(secret, 'base64url');
  if (master.length !== 32) throw new Error('DATA_ENCRYPTION_KEY는 32바이트 무작위 값(base64url 43자)이어야 합니다');
  const derive = (info: string) => Buffer.from(crypto.hkdfSync('sha256', master, Buffer.alloc(0), info, 32));
  return { enc: derive('saju-profile-encryption'), mac: derive('saju-profile-dedupe') };
}

/** [iv 12바이트][인증 태그 16바이트][암호문] */
export function seal(key: Buffer, plaintext: string): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function unseal(key: Buffer, blob: Uint8Array): string {
  const data = Buffer.from(blob);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}

const error = (reply: FastifyReply, status: number, code: string) => reply.code(status).send({ errors: [{ field: null, code }] });

export function registerProfiles(app: FastifyInstance, deps: {
  db: DatabaseSync;
  dataKey: string;
  userIdOf: (req: FastifyRequest) => string | null;
  buildReading: (profile: ProfileInput, options: SajuOptions) => Reading;
  bodySchema: object;
  now: () => number;
}) {
  const { db, userIdOf, now } = deps;
  const keys = profileKeys(deps.dataKey);

  const decode = (row: Row): { profile: ProfileInput; options: SajuOptions } => ({
    profile: {
      name: row.name_enc ? unseal(keys.enc, row.name_enc) : '',
      gender: row.gender as ProfileInput['gender'],
      regionCode: row.region_code,
      ...JSON.parse(unseal(keys.enc, row.birth_enc)),
    },
    options: JSON.parse(row.options),
  });

  const summarize = (row: Row) => {
    const { profile, options } = decode(row);
    const { chart } = calculate(profile, options, now());
    return {
      profileId: row.profile_id,
      ...profile,
      options,
      tag: row.tag,
      isPrimary: row.is_primary === 1,
      createdAt: row.created_at,
      dayPillar: LABELS[chart.pillars.day.stem] + LABELS[chart.pillars.day.branch],
      currentDaewoon: chart.daewoon.current?.ganjiKo ?? null,
      thisYearSeun: chart.seun.ganjiKo,
    };
  };

  // 같은 사람 · 같은 출생 정보면 같은 값. 계산 방식(자시 · 경도 보정)은 포함하지 않는다
  const inputHash = (p: ProfileInput) => crypto.createHmac('sha256', keys.mac)
    .update(JSON.stringify([p.name?.trim() ?? '', p.gender, p.calendar, !!p.isLeapMonth, p.birthDate, p.birthTime ?? null, p.regionCode ?? '11']))
    .digest('base64url');

  const ownRow = (req: FastifyRequest, userId: string) =>
    db.prepare('SELECT * FROM saju_profile WHERE profile_id = ? AND user_id = ?').get((req.params as { id: string }).id, userId) as Row | undefined;

  app.get('/v1/profiles', async (req, reply) => {
    const userId = userIdOf(req);
    if (!userId) return error(reply, 401, 'UNAUTHORIZED');
    reply.header('Cache-Control', 'no-store');
    const rows = db.prepare('SELECT * FROM saju_profile WHERE user_id = ? ORDER BY is_primary DESC, created_at DESC, rowid DESC').all(userId) as Row[];
    return { limit: ARCHIVE_LIMIT, profiles: rows.map(summarize) };
  });

  app.post('/v1/profiles', { schema: { body: deps.bodySchema } }, async (req, reply) => {
    const userId = userIdOf(req);
    if (!userId) return error(reply, 401, 'UNAUTHORIZED');

    const body = req.body as { profile: ProfileInput; options: SajuOptions };
    const profile = body.profile;
    const options: SajuOptions = { jasiMode: body.options.jasiMode, longitudeCorrection: body.options.longitudeCorrection };
    try {
      calculate(profile, options, now()); // 저장 전에 입력 검증
    } catch (e) {
      if (e instanceof SajuInputError) return reply.code(400).send({ errors: e.errors });
      throw e;
    }

    const hash = inputHash(profile);
    const existing = db.prepare('SELECT * FROM saju_profile WHERE user_id = ? AND input_hash = ?').get(userId, hash) as Row | undefined;
    if (existing) {
      db.prepare('UPDATE saju_profile SET options = ? WHERE profile_id = ?').run(JSON.stringify(options), existing.profile_id);
      return reply.code(200).send({ created: false, profile: summarize({ ...existing, options: JSON.stringify(options) }) });
    }

    const { n } = db.prepare('SELECT COUNT(*) AS n FROM saju_profile WHERE user_id = ?').get(userId) as { n: number };
    if (n >= ARCHIVE_LIMIT) return error(reply, 409, 'ARCHIVE_FULL');

    const profileId = crypto.randomUUID();
    const name = profile.name?.trim();
    const birth = { calendar: profile.calendar, isLeapMonth: !!profile.isLeapMonth, birthDate: profile.birthDate, birthTime: profile.birthTime ?? null };
    db.prepare(`INSERT INTO saju_profile (profile_id, user_id, input_hash, name_enc, birth_enc, gender, region_code, options)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      profileId, userId, hash, name ? seal(keys.enc, name) : null, seal(keys.enc, JSON.stringify(birth)),
      profile.gender, profile.regionCode ?? '11', JSON.stringify(options),
    );
    const row = db.prepare('SELECT * FROM saju_profile WHERE profile_id = ?').get(profileId) as Row;
    return reply.code(201).send({ created: true, profile: summarize(row) });
  });

  app.get('/v1/profiles/:id', async (req, reply) => {
    const userId = userIdOf(req);
    if (!userId) return error(reply, 401, 'UNAUTHORIZED');
    reply.header('Cache-Control', 'no-store');
    const row = ownRow(req, userId);
    if (!row) return error(reply, 404, 'NOT_FOUND'); // 남의 사주도 "없음"으로 응답
    const { profile, options } = decode(row);
    return { profileId: row.profile_id, profile, options, reading: deps.buildReading(profile, options) };
  });

  // 태그 · 대표 지정. 대표로 지정하면 기존 대표는 해제된다 (사용자당 하나, DB 고유 인덱스로도 보장)
  app.patch('/v1/profiles/:id', { schema: { body: PATCH_BODY } }, async (req, reply) => {
    const userId = userIdOf(req);
    if (!userId) return error(reply, 401, 'UNAUTHORIZED');
    const row = ownRow(req, userId);
    if (!row) return error(reply, 404, 'NOT_FOUND');

    const patch = req.body as { tag?: string | null; isPrimary?: boolean };
    transaction(db, () => {
      if ('tag' in patch) db.prepare('UPDATE saju_profile SET tag = ? WHERE profile_id = ?').run(patch.tag ?? null, row.profile_id);
      if (patch.isPrimary === true) {
        db.prepare('UPDATE saju_profile SET is_primary = 0 WHERE user_id = ? AND is_primary = 1').run(userId);
        db.prepare('UPDATE saju_profile SET is_primary = 1 WHERE profile_id = ?').run(row.profile_id);
      } else if (patch.isPrimary === false) {
        db.prepare('UPDATE saju_profile SET is_primary = 0 WHERE profile_id = ?').run(row.profile_id);
      }
    });
    return { profile: summarize(ownRow(req, userId)!) };
  });

  app.delete('/v1/profiles/:id', async (req, reply) => {
    const userId = userIdOf(req);
    if (!userId) return error(reply, 401, 'UNAUTHORIZED');
    const { changes } = db.prepare('DELETE FROM saju_profile WHERE profile_id = ? AND user_id = ?').run((req.params as { id: string }).id, userId);
    return changes ? reply.code(204).send() : error(reply, 404, 'NOT_FOUND');
  });

  // 공유 링크 (PRD §7.3): 회원이 자기 보관함 사주로 만든다. 누를 때마다 새 링크 (30일 뒤 만료)
  app.post('/v1/profiles/:id/share', { schema: { body: SHARE_BODY } }, async (req, reply) => {
    const userId = userIdOf(req);
    if (!userId) return error(reply, 401, 'UNAUTHORIZED');
    const row = ownRow(req, userId);
    if (!row) return error(reply, 404, 'NOT_FOUND');

    const token = crypto.randomBytes(16).toString('base64url'); // 22자, 추측 불가
    const expiresAt = new Date(now() + SHARE_DAYS * 86_400_000).toISOString();
    const hide = (req.body as { hideBirth: boolean }).hideBirth ? 1 : 0;
    db.prepare('INSERT INTO share_link (token, profile_id, hide_birth, expires_at) VALUES (?, ?, ?, ?)').run(token, row.profile_id, hide, expiresAt);
    return reply.code(201).send({ token, expiresAt });
  });

  // 공유 링크 열람: 로그인 불필요. 없음 · 만료 · 사주 삭제를 구분하지 않고 404
  app.get('/v1/share/:token', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const row = db.prepare(`SELECT p.*, s.hide_birth, s.expires_at AS share_expires_at
      FROM share_link s JOIN saju_profile p ON p.profile_id = s.profile_id
      WHERE s.token = ? AND s.expires_at > ?`)
      .get((req.params as { token: string }).token, new Date(now()).toISOString()) as (Row & { hide_birth: number; share_expires_at: string }) | undefined;
    if (!row) return error(reply, 404, 'NOT_FOUND');

    const { profile, options } = decode(row);
    const hidden = row.hide_birth === 1;
    const reading = deps.buildReading(profile, options);
    return {
      profile: hidden ? { name: profile.name, gender: profile.gender } : profile,
      options,
      hideBirth: hidden,
      expiresAt: row.share_expires_at,
      reading: hidden ? hideBirth(reading) : reading,
    };
  });
}
