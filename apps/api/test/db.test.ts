// SQLite: 마이그레이션 · 룰 세트 저장/발행/로드 (PRD §5.2)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { migrate, openDb } from '../src/db.ts';
import { buildReport } from '../src/rules/engine.ts';
import type { RuleSet } from '../src/rules/engine.ts';
import { SAMPLE_CHART, loadRuleSet } from '../src/rules/authoring.ts';
import { loadPublishedRuleSet, publishRuleSet, versionOf } from '../src/rules/store.ts';

const content = (): RuleSet => {
  const { ruleSet } = loadRuleSet(path.resolve(import.meta.dirname, '../content'), '');
  return { ...ruleSet, version: versionOf(ruleSet) };
};
const statuses = (db: ReturnType<typeof openDb>) =>
  Object.fromEntries((db.prepare('SELECT version, status FROM rule_set').all() as { version: string; status: string }[]).map(r => [r.version, r.status]));

test('마이그레이션: 한 번만 적용되고 제약 조건이 동작한다', () => {
  const db = openDb(':memory:');
  migrate(db);
  const files = fs.readdirSync(path.resolve(import.meta.dirname, '../db/migrations')).filter(f => f.endsWith('.sql'));
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM schema_migration').get() as { n: number }).n, files.length);

  assert.throws(() => db.prepare("INSERT INTO saju_profile (profile_id, user_id, birth_enc, gender, options) VALUES ('p', 'no-such-user', x'00', 'M', '{}')").run(), /FOREIGN KEY/);
  assert.throws(() => db.prepare("INSERT INTO app_user (user_id, provider_uid, settings) VALUES ('u', 'sub', 'not json')").run(), /json_valid/);
});

test('룰 세트: 저장 → 발행 → DB에서 불러온 세트가 CSV와 같은 리포트를 만든다', () => {
  const db = openDb(':memory:');
  const rs = content();
  assert.match(rs.version, /^content-[0-9a-f]{10}$/);
  assert.equal(publishRuleSet(db, rs), true);
  assert.equal(publishRuleSet(db, rs), false); // 같은 내용이면 다시 저장하지 않는다

  const loaded = loadPublishedRuleSet(db)!;
  assert.equal(loaded.version, rs.version);
  assert.equal(versionOf(loaded), rs.version);
  assert.deepEqual(buildReport(SAMPLE_CHART, loaded, '홍길동'), buildReport(SAMPLE_CHART, rs, '홍길동'));
  assert.deepEqual(buildReport(SAMPLE_CHART, loaded), buildReport(SAMPLE_CHART, rs));
});

test('콘텐츠가 바뀌면 새 버전을 발행하고 이전 버전은 보관한다', () => {
  const db = openDb(':memory:');
  const v1 = content();
  publishRuleSet(db, v1);

  const v2 = structuredClone(v1);
  v2.rules[1].priority += 1;
  v2.version = versionOf(v2);
  assert.notEqual(v2.version, v1.version);
  publishRuleSet(db, v2);

  assert.deepEqual(statuses(db), { [v1.version]: 'ARCHIVED', [v2.version]: 'PUBLISHED' });
  assert.equal(loadPublishedRuleSet(db)!.version, v2.version);

  publishRuleSet(db, v1); // 이전 내용으로 되돌려 배포하면 다시 저장하지 않고 재발행
  assert.deepEqual(statuses(db), { [v1.version]: 'PUBLISHED', [v2.version]: 'ARCHIVED' });
});

test('이미 저장된 조건 코드의 의미가 바뀌면 발행을 막고 되돌린다', () => {
  const db = openDb(':memory:');
  const v1 = content();
  publishRuleSet(db, v1);

  const bad = structuredClone(v1);
  bad.conds.OH_WOOD_GT_40.value = 0.5;
  bad.version = versionOf(bad);
  assert.throws(() => publishRuleSet(db, bad), /OH_WOOD_GT_40/);
  assert.equal(loadPublishedRuleSet(db)!.version, v1.version);
  assert.deepEqual(Object.keys(statuses(db)), [v1.version]);
});
