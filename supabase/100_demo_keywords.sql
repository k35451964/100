-- =====================================================================
-- 시연용 키워드 한 번에 넣기
-- 사용법
--   1) 아래 'ABCDEF' 를 시연용 학반의 참여 코드로 바꿉니다. (사이트 ⚙️ 관리 → 학반 탭에 보이는 6글자)
--   2) 키워드 목록을 원하는 대로 고칩니다. 같은 말을 여러 번 쓰면 그만큼 동그라미가 커집니다.
--   3) SQL Editor → New query → 붙여넣고 [Run]
-- 다시 실행하면 그만큼 또 더해집니다. 처음부터 다시 하려면 맨 아래 '지우기' 줄의 -- 를 지우고 실행하세요.
-- =====================================================================
do $$
declare
    v_code constant text := 'ABCDEF';   -- ← 시연용 학반 참여 코드
    v_id bigint;
    kw text;
    keywords text[] := array[
        '맥도날드', '맥도날드', '맥도날드', '맥도날드', '맥도날드',
        '스타벅스', '스타벅스', '스타벅스',
        'PC방', 'PC방', 'PC방',
        '편의점', '편의점', '편의점',
        '다이소', '다이소',
        '이마트', '이마트',
        '노래방', '노래방',
        '공원', '공원',
        '아파트', '영화관', '수영장', '놀이공원', '주차장', '지하철역',
        '마라탕', '볼링장', '올리브영', '탕후루', '헬스장', '기숙사', '도서관', '코인노래방'
    ];
begin
    select id into v_id from public.classrooms where code = upper(v_code);
    if v_id is null then
        raise exception '학반 코드 % 를 찾을 수 없어요. 코드를 확인해 주세요.', v_code;
    end if;
    foreach kw in array keywords loop
        insert into public.classroom_keywords (classroom_id, text) values (v_id, kw);
    end loop;
    raise notice '키워드 %개를 넣었어요.', array_length(keywords, 1);
end;
$$;

-- 지우기 (처음부터 다시 넣고 싶을 때만 아래 줄 맨 앞의 -- 를 지우고 코드를 바꿔 실행)
-- delete from public.classroom_keywords where classroom_id = (select id from public.classrooms where code = 'ABCDEF');

select c.name as 학반, count(k.id) as 키워드_수
from public.classrooms c left join public.classroom_keywords k on k.classroom_id = c.id
group by c.name order by c.name;
