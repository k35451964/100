-- =====================================================================
-- 업데이트 3: 포스터 제목 칸 (조 이름과 따로, 포스터의 제목·핵심 문구를 적음)
-- 사용법: SQL Editor → New query → 붙여넣고 [Run]. 여러 번 실행해도 안전합니다.
-- (100_setup.sql 을 새로 실행하는 경우에는 이미 들어 있어 따로 안 해도 됨)
-- =====================================================================
alter table public.classroom_posters
    add column if not exists headline text not null default '' check (char_length(headline) <= 60);

-- 새 칸을 사이트가 바로 알아보게
notify pgrst, 'reload schema';
