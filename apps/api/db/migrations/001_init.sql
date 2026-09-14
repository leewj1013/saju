-- Saju Project 초기 스키마 (PRD §5.2) · SQLite
-- 시각: ISO-8601 UTC 문자열 · JSON: TEXT + json_valid · 참/거짓: 0/1 · ID(UUID): 앱에서 crypto.randomUUID()
-- 외래 키는 연결마다 PRAGMA foreign_keys = ON 해야 동작한다 (src/db.ts)

-- 룰 세트 버전: 발행된 버전은 하나뿐
CREATE TABLE rule_set (
  version       TEXT PRIMARY KEY,                     -- 'content-3f9a1c2b7d' (콘텐츠 내용 해시)
  status        TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  published_at  TEXT,
  note          TEXT
);
CREATE UNIQUE INDEX rule_set_one_published ON rule_set (status) WHERE status = 'PUBLISHED';

-- 원자 조건 사전. 한 번 저장된 코드의 의미는 바꾸지 않는다 (바꾸려면 새 코드, src/rules/store.ts가 막음)
CREATE TABLE condition_code (
  code        TEXT PRIMARY KEY,                       -- 'OH_WOOD_GT_40'
  param_key   TEXT NOT NULL,                          -- 'oh.ratio.WOOD'
  operator    TEXT NOT NULL CHECK (operator IN ('eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains')),
  value       TEXT NOT NULL CHECK (json_valid(value)),-- 0.4 / "GAP" / ["WEAK","VERY_WEAK"]
  label_ko    TEXT NOT NULL
);

-- 카테고리별 섹션과 노출 개수
CREATE TABLE report_section (
  category       TEXT NOT NULL,                       -- TOTAL / PERSONALITY / WEALTH / CAREER / LOVE / DAEWOON
  section        TEXT NOT NULL,                       -- SUMMARY / DETAIL / ADVICE
  display_order  INTEGER NOT NULL,
  max_items      INTEGER NOT NULL DEFAULT 1,
  title_ko       TEXT,
  PRIMARY KEY (category, section)
);

CREATE TABLE saju_rule (
  rule_id          INTEGER PRIMARY KEY,
  rule_set_ver     TEXT NOT NULL REFERENCES rule_set (version),
  rule_code        TEXT NOT NULL,
  category         TEXT NOT NULL,
  section          TEXT NOT NULL,
  expr             TEXT NOT NULL CHECK (json_valid(expr)), -- {"all":["DM_GAP","OH_WOOD_GT_40"]}
  priority         INTEGER NOT NULL DEFAULT 100,
  exclusive_group  TEXT,
  is_fallback      INTEGER NOT NULL DEFAULT 0 CHECK (is_fallback IN (0, 1)),
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  UNIQUE (rule_set_ver, rule_code),
  FOREIGN KEY (category, section) REFERENCES report_section (category, section)
);

CREATE TABLE saju_template (
  template_id  INTEGER PRIMARY KEY,
  rule_id      INTEGER NOT NULL REFERENCES saju_rule (rule_id) ON DELETE CASCADE,
  variant_no   INTEGER NOT NULL DEFAULT 1,
  title        TEXT,
  body         TEXT NOT NULL,                         -- '{{name}}님은 {{dm.nameKo|은는}} …'
  UNIQUE (rule_id, variant_no)
);

-- 사용자 데이터
CREATE TABLE app_user (
  user_id       TEXT PRIMARY KEY,
  provider      TEXT NOT NULL DEFAULT 'GOOGLE',       -- 로그인은 Google만 사용
  provider_uid  TEXT NOT NULL,                        -- Google 계정 고유 ID (sub)
  settings      TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings)), -- 기본 jasiMode, longitudeCorrection
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (provider, provider_uid)
);

CREATE TABLE saju_profile (
  profile_id        TEXT PRIMARY KEY,
  user_id           TEXT REFERENCES app_user (user_id) ON DELETE CASCADE, -- NULL = 비회원
  guest_token_hash  TEXT,
  name_enc          BLOB,                             -- AES-256-GCM
  birth_enc         BLOB NOT NULL,                    -- {calendar, isLeapMonth, date, time} 암호화
  gender            TEXT NOT NULL CHECK (gender IN ('M', 'F')),
  region_code       TEXT NOT NULL DEFAULT '11',
  options           TEXT NOT NULL CHECK (json_valid(options)),
  tag               TEXT,                             -- 본인 / 가족 / 친구 / 연인 / 기타
  is_primary        INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  expires_at        TEXT,                             -- 비회원: 생성 + 7일
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX saju_profile_user ON saju_profile (user_id);
CREATE INDEX saju_profile_expires ON saju_profile (expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE saju_reading (
  reading_id      TEXT PRIMARY KEY,
  profile_id      TEXT NOT NULL REFERENCES saju_profile (profile_id) ON DELETE CASCADE,
  engine_version  TEXT NOT NULL,
  rule_set_ver    TEXT NOT NULL REFERENCES rule_set (version),
  chart           TEXT NOT NULL CHECK (json_valid(chart)), -- 엔진 chart (원문 개인정보 제외)
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX saju_reading_profile ON saju_reading (profile_id);

-- 해석 스냅샷: 룰이 바뀌어도 저장된 결과 문장은 그대로
CREATE TABLE result_text (
  reading_id     TEXT NOT NULL REFERENCES saju_reading (reading_id) ON DELETE CASCADE,
  category       TEXT NOT NULL,
  section        TEXT NOT NULL,
  seq            INTEGER NOT NULL,
  template_id    INTEGER NOT NULL REFERENCES saju_template (template_id),
  rendered_text  TEXT NOT NULL,
  PRIMARY KEY (reading_id, category, section, seq)
);

CREATE TABLE share_link (
  token       TEXT PRIMARY KEY,                       -- 무작위 base62 22자, 개인정보 미포함
  reading_id  TEXT NOT NULL REFERENCES saju_reading (reading_id) ON DELETE CASCADE,
  hide_birth  INTEGER NOT NULL DEFAULT 1 CHECK (hide_birth IN (0, 1)),
  expires_at  TEXT NOT NULL,                          -- 기본 30일
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
