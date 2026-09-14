// 룰 세트 DB 저장 · 발행 · 로드 (PRD §5.2)
// 콘텐츠 CSV가 원본이다. 서버가 시작할 때 내용으로 버전을 만들고, 처음 보는 버전이면 저장한 뒤 발행한다.
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { transaction } from '../db.ts';
import type { RuleSet } from './engine.ts';

/** 섹션 · 룰 · 템플릿 · 조건 내용으로 만든 버전 이름. 내용이 같으면 같은 버전 */
export function versionOf(rs: RuleSet): string {
  const { version: _, ...content } = rs;
  return `content-${crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 10)}`;
}

/** 이 버전을 발행한다. DB에 없으면 먼저 저장. 이전 발행본은 ARCHIVED. 반환: 새로 저장했는지 */
export function publishRuleSet(db: DatabaseSync, rs: RuleSet): boolean {
  return transaction(db, () => {
    const existing = db.prepare('SELECT status FROM rule_set WHERE version = ?').get(rs.version) as { status: string } | undefined;

    if (!existing) {
      db.prepare("INSERT INTO rule_set (version, status) VALUES (?, 'DRAFT')").run(rs.version);

      const findCond = db.prepare('SELECT param_key, operator, value FROM condition_code WHERE code = ?');
      const insertCond = db.prepare('INSERT INTO condition_code (code, param_key, operator, value, label_ko) VALUES (?, ?, ?, ?, ?)');
      for (const c of Object.values(rs.conds)) {
        const value = JSON.stringify(c.value);
        const row = findCond.get(c.code) as { param_key: string; operator: string; value: string } | undefined;
        if (!row) insertCond.run(c.code, c.paramKey, c.operator, value, c.labelKo);
        else if (row.param_key !== c.paramKey || row.operator !== c.operator || row.value !== value) {
          throw new Error(`조건 코드 ${c.code}의 의미가 바뀌었습니다. 기존 코드는 두고 새 코드를 만드세요.`);
        }
      }

      const upsertSection = db.prepare(`INSERT INTO report_section (category, section, display_order, max_items, title_ko) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (category, section) DO UPDATE SET display_order = excluded.display_order, max_items = excluded.max_items, title_ko = excluded.title_ko`);
      for (const s of rs.sections) upsertSection.run(s.category, s.section, s.displayOrder, s.maxItems, s.titleKo);

      const insertRule = db.prepare(`INSERT INTO saju_rule
        (rule_set_ver, rule_code, category, section, expr, priority, exclusive_group, is_fallback, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const insertTemplate = db.prepare('INSERT INTO saju_template (rule_id, variant_no, title, body) VALUES (?, ?, ?, ?)');
      for (const r of rs.rules) {
        const { lastInsertRowid } = insertRule.run(
          rs.version, r.ruleCode, r.category, r.section, JSON.stringify(r.expr), r.priority, r.exclusiveGroup,
          r.isFallback ? 1 : 0, r.isActive ? 1 : 0,
        );
        for (const t of r.templates) insertTemplate.run(lastInsertRowid, t.variantNo, t.title, t.body);
      }
    }

    if (existing?.status !== 'PUBLISHED') {
      db.prepare("UPDATE rule_set SET status = 'ARCHIVED' WHERE status = 'PUBLISHED'").run();
      db.prepare("UPDATE rule_set SET status = 'PUBLISHED', published_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE version = ?").run(rs.version);
    }
    return !existing;
  });
}

export function loadPublishedRuleSet(db: DatabaseSync): RuleSet | null {
  const published = db.prepare("SELECT version FROM rule_set WHERE status = 'PUBLISHED'").get() as { version: string } | undefined;
  if (!published) return null;

  const conds = Object.fromEntries((db.prepare('SELECT * FROM condition_code').all() as any[]).map(c => [
    c.code, { code: c.code, paramKey: c.param_key, operator: c.operator, value: JSON.parse(c.value), labelKo: c.label_ko },
  ]));
  const sections = (db.prepare('SELECT * FROM report_section').all() as any[]).map(s => ({
    category: s.category, section: s.section, displayOrder: s.display_order, maxItems: s.max_items, titleKo: s.title_ko,
  }));
  const templates = db.prepare(`SELECT t.* FROM saju_template t JOIN saju_rule r USING (rule_id)
    WHERE r.rule_set_ver = ? ORDER BY t.rule_id, t.variant_no`).all(published.version) as any[];
  const rules = (db.prepare('SELECT * FROM saju_rule WHERE rule_set_ver = ? ORDER BY rule_id').all(published.version) as any[]).map(r => ({
    ruleCode: r.rule_code, category: r.category, section: r.section, expr: JSON.parse(r.expr), priority: r.priority,
    exclusiveGroup: r.exclusive_group, isFallback: r.is_fallback === 1, isActive: r.is_active === 1,
    templates: templates.filter(t => t.rule_id === r.rule_id).map(t => ({ variantNo: t.variant_no, title: t.title ?? '', body: t.body })),
  }));

  return { version: published.version, sections, conds, rules };
}
