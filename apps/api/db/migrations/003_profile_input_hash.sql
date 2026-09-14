-- 보관함 중복 저장 방지: 입력값의 HMAC (키 없이는 원래 값을 알 수 없다)
ALTER TABLE saju_profile ADD COLUMN input_hash TEXT;
CREATE UNIQUE INDEX saju_profile_user_input ON saju_profile (user_id, input_hash) WHERE user_id IS NOT NULL;
