-- 궁합 결과 공유 링크 (회원). 두 사람의 입력(상대가 사주 공유 링크로 받은 사람이면 그 토큰)을 암호화해 두고 열 때마다 다시 계산한다.
-- 만든 사람이 탈퇴하면 함께 지워지고, 30일 뒤 만료된다
CREATE TABLE match_share (
  token       TEXT PRIMARY KEY,                       -- 무작위 16바이트 base64url 22자
  user_id     TEXT NOT NULL REFERENCES app_user (user_id) ON DELETE CASCADE,
  data_enc    BLOB NOT NULL,                          -- AES-256-GCM {a, b, relation}
  hide_birth  INTEGER NOT NULL DEFAULT 1 CHECK (hide_birth IN (0, 1)),
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX match_share_user ON match_share (user_id);
