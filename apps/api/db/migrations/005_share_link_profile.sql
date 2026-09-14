-- 공유 링크를 보관함 사주(saju_profile)에 연결한다. 결과는 열 때마다 다시 계산하므로 saju_reading을 거치지 않는다.
-- 사주를 지우거나 탈퇴하면 링크도 함께 사라진다. (001의 share_link는 쓰인 적이 없어 새로 만든다)
DROP TABLE share_link;

CREATE TABLE share_link (
  token       TEXT PRIMARY KEY,                       -- 무작위 16바이트 base64url 22자, 개인정보 미포함
  profile_id  TEXT NOT NULL REFERENCES saju_profile (profile_id) ON DELETE CASCADE,
  hide_birth  INTEGER NOT NULL DEFAULT 1 CHECK (hide_birth IN (0, 1)),
  expires_at  TEXT NOT NULL,                          -- 만든 때 + 30일
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX share_link_profile ON share_link (profile_id);
