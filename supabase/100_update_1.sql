-- =====================================================================
-- 업데이트 1: 조 배정이 학생 화면에 바로 뜨게 (실시간)
-- 사용법: SQL Editor → New query → 붙여넣고 [Run]. 여러 번 실행해도 안전합니다.
-- (100_setup.sql 을 새로 실행하는 경우에는 이미 들어 있어 따로 안 해도 됨)
-- =====================================================================
do $$
begin
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'classroom_members') then
        alter publication supabase_realtime add table public.classroom_members;
    end if;
end;
$$;
select '조 배정 실시간 켜짐' as 결과;
