-- 대표 사주는 사용자당 하나
CREATE UNIQUE INDEX saju_profile_one_primary ON saju_profile (user_id) WHERE is_primary = 1;
