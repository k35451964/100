-- =====================================================================
-- 업데이트 2: 조별 예측 (2차시 도입에서 미래 보기 전에 사라질 생물을 조별로 고름)
-- 사용법: SQL Editor → New query → 붙여넣고 [Run]. 여러 번 실행해도 안전합니다.
-- (100_setup.sql 을 새로 실행하는 경우에는 이미 들어 있어 따로 안 해도 됨)
-- =====================================================================
-- ---------- 조별 예측 (2차시 도입: 미래 보기 전에 사라질 생물 예측) ----------
create table if not exists public.classroom_predictions (
    classroom_id bigint      not null references public.classrooms (id) on delete cascade,
    team         smallint    not null,
    species      text[]      not null default '{}' check (coalesce(array_length(species, 1), 0) <= 5),
    reason       text        not null default '' check (char_length(reason) <= 500),
    updated_at   timestamptz not null default now(),
    primary key (classroom_id, team)
);

-- 예측을 쓰거나 바꿀 수 있는가: 그 조 학생(미래 지도가 열리기 전까지) 또는 담당 교사
create or replace function public.classroom_can_predict(p_classroom bigint, p_team smallint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.classroom_is_teacher(p_classroom)
        or (public.classroom_can_edit_poster(p_classroom, p_team)
            and not exists (select 1 from public.classrooms c where c.id = p_classroom and c.future_open));
$$;

alter table public.classroom_predictions enable row level security;
drop policy if exists "예측 보기" on public.classroom_predictions;
create policy "예측 보기" on public.classroom_predictions for select
    using (public.classroom_is_member(classroom_id) or public.classroom_is_teacher(classroom_id));
drop policy if exists "예측 쓰기" on public.classroom_predictions;
create policy "예측 쓰기" on public.classroom_predictions for insert to authenticated
    with check (public.classroom_can_predict(classroom_id, team));
drop policy if exists "예측 바꾸기" on public.classroom_predictions;
create policy "예측 바꾸기" on public.classroom_predictions for update to authenticated
    using (public.classroom_can_predict(classroom_id, team))
    with check (public.classroom_can_predict(classroom_id, team));
drop policy if exists "예측 지우기" on public.classroom_predictions;
create policy "예측 지우기" on public.classroom_predictions for delete to authenticated
    using (public.classroom_is_teacher(classroom_id));
grant select, insert, update, delete on public.classroom_predictions to authenticated;

do $$
begin
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'classroom_predictions') then
        alter publication supabase_realtime add table public.classroom_predictions;
    end if;
end;
$$;

select '조별 예측 준비됨' as 결과;
