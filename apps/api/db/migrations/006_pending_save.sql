-- 비회원 결과를 로그인 뒤 보관함으로 옮기기: 로그인 도중 브라우저가 바뀌어도(카카오톡 → Chrome) 이어지도록
-- 입력(이름 · 생년월일시)을 30분 동안만 암호화해 맡긴다. 토큰은 해시만 저장하고, 한 번 가져가면 지운다
CREATE TABLE pending_save (
  token_hash  TEXT PRIMARY KEY,
  data_enc    BLOB NOT NULL,                          -- AES-256-GCM {profile, options}
  expires_at  TEXT NOT NULL
);
