-- 로그인 세션 (웹: httpOnly 쿠키). 쿠키 원문은 저장하지 않고 SHA-256 해시만 둔다
CREATE TABLE auth_session (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES app_user (user_id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX auth_session_user ON auth_session (user_id);
CREATE INDEX auth_session_expires ON auth_session (expires_at);
