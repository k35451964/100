-- =====================================================================
-- 기후변화 생태 수업 사이트(저장소 100) DB 설정
--
-- 사용법: 생태지도(티치타카)와 같은 Supabase 프로젝트 → SQL Editor → New query → 전부 붙여넣고 [Run]
--         여러 번 실행해도 안전합니다. 생태지도의 기존 표는 바꾸지 않고 읽기만 합니다.
--
-- 만드는 것
--   classrooms          학반 (교사가 만들고 코드를 나눠 줌, 1·2차시 모드, 생물 기록 출처, 키워드 분석 결과)
--   classroom_members   학반 학생과 조
--   classroom_keywords  1차시 키워드 (익명: 쓴 사람을 저장하지 않음)
--   classroom_posters   조별 포스터 (조마다 1장, 조원 누구나 올리고 바꿈)
--   poster_ratings      포스터 별점 (익명: 본인 것만 볼 수 있고, 평균은 함수로만 공개)
--   저장 공간 classroom-posters (포스터 사진)
--
-- 필요: 생태지도의 roles_v4.sql (교사 역할), clans.sql (_my_nickname)
-- =====================================================================

-- ---------- 학반 코드 만들기 (헷갈리는 글자 O·0·I·1 제외) ----------
create or replace function public._gen_classroom_code()
returns text
language plpgsql
volatile
as $$
declare
    chars constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    result text;
begin
    loop
        result := '';
        for i in 1..6 loop
            result := result || substr(chars, 1 + floor(random() * length(chars))::int, 1);
        end loop;
        exit when not exists (select 1 from public.classrooms where code = result);
    end loop;
    return result;
exception when undefined_table then
    return result; -- 표를 처음 만드는 중
end;
$$;

-- ---------- 표 ----------
create table if not exists public.classrooms (
    id             bigint generated always as identity primary key,
    name           text        not null check (char_length(name) between 1 and 40),
    code           text        not null unique,
    teacher_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
    team_count     smallint    not null default 5 check (team_count between 1 and 12),
    mode           smallint    not null default 1 check (mode in (1, 2)),       -- 1차시 / 2차시
    center_lat     double precision,                                            -- 지도 가운데 (학교)
    center_lon     double precision,
    radius_m       integer     not null default 500 check (radius_m between 100 and 3000),
    source_kind    text        not null default 'members' check (source_kind in ('members', 'clan', 'area')),
                                                                                -- 생물 기록: 학반 학생 / 생태지도 클랜 / 지도 범위 안 모든 기록
    source_clan_id bigint,                                                      -- 생태지도 클랜 기록을 쓸 때
    date_from      date,                                                        -- 이 기간의 생태지도 기록만
    date_to        date,
    analysis       jsonb,                                                       -- 키워드 분류 (교사 확인·수정)
    future_seed    integer     not null default floor(random() * 1000000)::int, -- 미래 지도 배치가 매번 같도록
    future_open    boolean     not null default false,                         -- 학생에게 미래 지도 열기
    results_open   boolean     not null default false,                         -- 별점 결과 공개
    created_at     timestamptz not null default now()
);
alter table public.classrooms alter column code set default public._gen_classroom_code();

create table if not exists public.classroom_members (
    classroom_id bigint      not null references public.classrooms (id) on delete cascade,
    user_id      uuid        not null references auth.users (id) on delete cascade,
    nickname     text        not null default '',
    team         smallint,
    joined_at    timestamptz not null default now(),
    primary key (classroom_id, user_id)
);
-- 예전에 만든 표에도 'area' 선택지를 더함
alter table public.classrooms drop constraint if exists classrooms_source_kind_check;
alter table public.classrooms add constraint classrooms_source_kind_check check (source_kind in ('members', 'clan', 'area'));

create index if not exists classroom_members_user_idx on public.classroom_members (user_id);

create table if not exists public.classroom_keywords (
    id           bigint generated always as identity primary key,
    classroom_id bigint      not null references public.classrooms (id) on delete cascade,
    text         text        not null check (char_length(btrim(text)) between 1 and 30),
    created_at   timestamptz not null default now()
);
create index if not exists classroom_keywords_class_idx on public.classroom_keywords (classroom_id);

create table if not exists public.classroom_posters (
    id           bigint generated always as identity primary key,
    classroom_id bigint      not null references public.classrooms (id) on delete cascade,
    team         smallint    not null,
    title        text        not null default '' check (char_length(title) <= 40),  -- 조 이름
    description  text        not null default '',
    image_url    text        not null default '',
    image_path   text,                                                               -- 저장 공간 경로 (바꿀 때 지움)
    updated_at   timestamptz not null default now(),
    unique (classroom_id, team)
);

create table if not exists public.poster_ratings (
    poster_id  bigint      not null references public.classroom_posters (id) on delete cascade,
    rater_id   uuid        not null default auth.uid(),
    aesthetic  smallint    not null check (aesthetic between 1 and 5),   -- 미적 완성도
    creativity smallint    not null check (creativity between 1 and 5),  -- 창의성
    solving    smallint    not null check (solving between 1 and 5),     -- 문제 해결력
    updated_at timestamptz not null default now(),
    primary key (poster_id, rater_id)
);

-- ---------- 권한 판단 도우미 ----------
create or replace function public.classroom_is_teacher(p_classroom bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (select 1 from public.classrooms c where c.id = p_classroom and c.teacher_id = auth.uid())
        or (auth.uid() is not null and public.my_role() = 'admin');
$$;

create or replace function public.classroom_is_member(p_classroom bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (select 1 from public.classroom_members m where m.classroom_id = p_classroom and m.user_id = auth.uid());
$$;

create or replace function public.classroom_my_team(p_classroom bigint)
returns smallint
language sql
stable
security definer
set search_path = public
as $$
    select m.team from public.classroom_members m where m.classroom_id = p_classroom and m.user_id = auth.uid();
$$;

-- 포스터를 올리거나 바꿀 수 있는가: 그 조의 학생 또는 담당 교사
create or replace function public.classroom_can_edit_poster(p_classroom bigint, p_team smallint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.classroom_is_teacher(p_classroom)
        or exists (select 1 from public.classroom_members m
                   where m.classroom_id = p_classroom and m.user_id = auth.uid() and m.team = p_team);
$$;

-- 저장 공간 경로 '학반id/조/파일' 로 판단 (경로가 이상하면 거절)
create or replace function public.classroom_can_edit_poster_path(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    parts text[] := string_to_array(p_name, '/');
begin
    if array_length(parts, 1) <> 3 or parts[1] !~ '^\d+$' or parts[2] !~ '^\d+$' then
        return false;
    end if;
    return public.classroom_can_edit_poster(parts[1]::bigint, parts[2]::smallint);
end;
$$;

-- ---------- RLS ----------
alter table public.classrooms         enable row level security;
alter table public.classroom_members  enable row level security;
alter table public.classroom_keywords enable row level security;
alter table public.classroom_posters  enable row level security;
alter table public.poster_ratings     enable row level security;

-- 학반: 담당 교사와 학반 학생만 봄 / 교사 역할이 있는 사람만 만듦 / 담당 교사만 고치고 지움
drop policy if exists "학반 보기" on public.classrooms;
create policy "학반 보기" on public.classrooms for select
    using (public.classroom_is_teacher(id) or public.classroom_is_member(id));
drop policy if exists "학반 만들기" on public.classrooms;
create policy "학반 만들기" on public.classrooms for insert to authenticated
    with check (teacher_id = auth.uid() and public.my_role() in ('teacher', 'admin'));
drop policy if exists "학반 고치기" on public.classrooms;
create policy "학반 고치기" on public.classrooms for update to authenticated
    using (public.classroom_is_teacher(id)) with check (public.classroom_is_teacher(id));
drop policy if exists "학반 지우기" on public.classrooms;
create policy "학반 지우기" on public.classrooms for delete to authenticated
    using (public.classroom_is_teacher(id));

-- 학반 학생: 교사는 모두, 학생은 자기 줄만 봄 (참여는 join_classroom 함수로만)
drop policy if exists "학반 학생 보기" on public.classroom_members;
create policy "학반 학생 보기" on public.classroom_members for select
    using (user_id = auth.uid() or public.classroom_is_teacher(classroom_id));
drop policy if exists "학반 학생 빼기" on public.classroom_members;
create policy "학반 학생 빼기" on public.classroom_members for delete to authenticated
    using (user_id = auth.uid() or public.classroom_is_teacher(classroom_id));

-- 키워드: 학반 사람만 보고 씀, 교사만 지움 (쓴 사람은 저장하지 않음)
drop policy if exists "키워드 보기" on public.classroom_keywords;
create policy "키워드 보기" on public.classroom_keywords for select
    using (public.classroom_is_member(classroom_id) or public.classroom_is_teacher(classroom_id));
drop policy if exists "키워드 쓰기" on public.classroom_keywords;
create policy "키워드 쓰기" on public.classroom_keywords for insert to authenticated
    with check (public.classroom_is_member(classroom_id) or public.classroom_is_teacher(classroom_id));
drop policy if exists "키워드 지우기" on public.classroom_keywords;
create policy "키워드 지우기" on public.classroom_keywords for delete to authenticated
    using (public.classroom_is_teacher(classroom_id));

-- 포스터: 학반 사람은 모두 봄 / 그 조 학생과 교사가 올리고 바꿈 / 교사만 지움
drop policy if exists "포스터 보기" on public.classroom_posters;
create policy "포스터 보기" on public.classroom_posters for select
    using (public.classroom_is_member(classroom_id) or public.classroom_is_teacher(classroom_id));
drop policy if exists "포스터 올리기" on public.classroom_posters;
create policy "포스터 올리기" on public.classroom_posters for insert to authenticated
    with check (public.classroom_can_edit_poster(classroom_id, team));
drop policy if exists "포스터 바꾸기" on public.classroom_posters;
create policy "포스터 바꾸기" on public.classroom_posters for update to authenticated
    using (public.classroom_can_edit_poster(classroom_id, team))
    with check (public.classroom_can_edit_poster(classroom_id, team));
drop policy if exists "포스터 지우기" on public.classroom_posters;
create policy "포스터 지우기" on public.classroom_posters for delete to authenticated
    using (public.classroom_is_teacher(classroom_id));

-- 별점: 본인이 준 것만 봄(교사도 남의 별점은 못 봄) / 결과 공개 전, 같은 학반 학생이 다른 조 포스터에만
create or replace function public.can_rate_poster(p_poster bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.classroom_posters p
        join public.classrooms c on c.id = p.classroom_id
        join public.classroom_members m on m.classroom_id = p.classroom_id and m.user_id = auth.uid()
        where p.id = p_poster
          and not c.results_open
          and (m.team is null or m.team <> p.team)
    );
$$;

drop policy if exists "내 별점 보기" on public.poster_ratings;
create policy "내 별점 보기" on public.poster_ratings for select using (rater_id = auth.uid());
drop policy if exists "별점 주기" on public.poster_ratings;
create policy "별점 주기" on public.poster_ratings for insert to authenticated
    with check (rater_id = auth.uid() and public.can_rate_poster(poster_id));
drop policy if exists "별점 바꾸기" on public.poster_ratings;
create policy "별점 바꾸기" on public.poster_ratings for update to authenticated
    using (rater_id = auth.uid()) with check (rater_id = auth.uid() and public.can_rate_poster(poster_id));
drop policy if exists "별점 지우기" on public.poster_ratings;
create policy "별점 지우기" on public.poster_ratings for delete to authenticated
    using (rater_id = auth.uid());

-- 학반 표는 위 정책을 거쳐서만
grant select, insert, update, delete on public.classrooms, public.classroom_keywords, public.classroom_posters,
    public.poster_ratings to authenticated;
grant select, delete on public.classroom_members to authenticated;

-- ---------- 함수: 학반 참여 / 조 정하기 / 생물 기록 주인 / 별점 결과 ----------

-- 학반 코드로 참여 (로그인 필요). 돌려줌: 학반 id
create or replace function public.join_classroom(p_code text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id bigint;
    v_nick text;
begin
    if auth.uid() is null then
        raise exception 'login required';
    end if;
    select id into v_id from public.classrooms where code = upper(btrim(coalesce(p_code, '')));
    if v_id is null then
        raise exception 'invalid code';
    end if;
    select nullif(btrim(p.nickname), '') into v_nick from public.profiles p where p.id = auth.uid();
    insert into public.classroom_members (classroom_id, user_id, nickname)
    values (v_id, auth.uid(), coalesce(v_nick, public._my_nickname()))
    on conflict (classroom_id, user_id) do nothing;
    return v_id;
end;
$$;
revoke execute on function public.join_classroom(text) from public, anon;
grant execute on function public.join_classroom(text) to authenticated;

-- 교사가 학생의 조를 정함 (null = 아직 안 정함)
create or replace function public.set_classroom_team(p_classroom bigint, p_user uuid, p_team smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_count smallint;
begin
    if not public.classroom_is_teacher(p_classroom) then
        raise exception 'not allowed';
    end if;
    select team_count into v_count from public.classrooms where id = p_classroom;
    if p_team is not null and (p_team < 1 or p_team > v_count) then
        raise exception 'invalid team';
    end if;
    update public.classroom_members set team = p_team where classroom_id = p_classroom and user_id = p_user;
end;
$$;
revoke execute on function public.set_classroom_team(bigint, uuid, smallint) from public, anon;
grant execute on function public.set_classroom_team(bigint, uuid, smallint) to authenticated;

-- 학반 학생들의 계정 id (학생이 생태지도에 올린 기록을 불러올 때). 학반 사람만 부를 수 있음
create or replace function public.classroom_member_ids(p_classroom bigint)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
    select m.user_id from public.classroom_members m
    where m.classroom_id = p_classroom
      and (public.classroom_is_member(p_classroom) or public.classroom_is_teacher(p_classroom));
$$;
revoke execute on function public.classroom_member_ids(bigint) from public, anon;
grant execute on function public.classroom_member_ids(bigint) to authenticated;

-- 별점 결과 (평균만, 누가 몇 점 줬는지는 아무도 볼 수 없음)
--   교사: 언제나 / 학생: 결과 공개 후
drop function if exists public.classroom_poster_results(bigint);
create function public.classroom_poster_results(p_classroom bigint)
returns table (poster_id bigint, team smallint, title text, raters integer,
               aesthetic numeric, creativity numeric, solving numeric, total numeric)
language sql
stable
security definer
set search_path = public
as $$
    select p.id, p.team, p.title,
           count(r.rater_id)::int,
           round(avg(r.aesthetic), 2), round(avg(r.creativity), 2), round(avg(r.solving), 2),
           round(avg((r.aesthetic + r.creativity + r.solving) / 3.0), 2)
    from public.classroom_posters p
    left join public.poster_ratings r on r.poster_id = p.id
    where p.classroom_id = p_classroom
      and (public.classroom_is_teacher(p_classroom)
           or (public.classroom_is_member(p_classroom)
               and exists (select 1 from public.classrooms c where c.id = p_classroom and c.results_open)))
    group by p.id, p.team, p.title
    order by p.team;
$$;
revoke execute on function public.classroom_poster_results(bigint) from public, anon;
grant execute on function public.classroom_poster_results(bigint) to authenticated;

-- ---------- 포스터 사진 저장 공간 ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('classroom-posters', 'classroom-posters', true, 10485760,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
    set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "포스터 사진 올리기" on storage.objects;
create policy "포스터 사진 올리기" on storage.objects for insert to authenticated
    with check (bucket_id = 'classroom-posters' and public.classroom_can_edit_poster_path(name));
drop policy if exists "포스터 사진 바꾸기" on storage.objects;
create policy "포스터 사진 바꾸기" on storage.objects for update to authenticated
    using (bucket_id = 'classroom-posters' and public.classroom_can_edit_poster_path(name));
drop policy if exists "포스터 사진 지우기" on storage.objects;
create policy "포스터 사진 지우기" on storage.objects for delete to authenticated
    using (bucket_id = 'classroom-posters' and public.classroom_can_edit_poster_path(name));

-- ---------- 실시간 (키워드가 바로 뜨고, 교사가 바꾼 모드가 학생 화면에 바로 반영) ----------
do $$
declare
    t text;
begin
    foreach t in array array['classrooms', 'classroom_keywords', 'classroom_posters', 'classroom_members'] loop
        if not exists (select 1 from pg_publication_tables
                       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
            execute format('alter publication supabase_realtime add table public.%I', t);
        end if;
    end loop;
end;
$$;

-- 확인: 아래 표가 나오면 성공
select 'classrooms' as 표, count(*) from public.classrooms
union all select 'classroom_members', count(*) from public.classroom_members
union all select 'classroom_keywords', count(*) from public.classroom_keywords
union all select 'classroom_posters', count(*) from public.classroom_posters;
