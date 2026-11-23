'use strict';
// 실제 서버(생태지도와 같은 Supabase)와 주고받기
// 예시 모드(api-demo.js)와 똑같은 함수 이름을 씁니다. 화면 코드는 API.함수() 로만 부릅니다.

const LiveAPI = (() => {
    let db = null;
    const PAGE = 1000;

    function must({ data, error }) {
        if (error) throw error;
        return data;
    }

    // 표 전체를 1000줄씩 나눠 끝까지 받기
    async function allRows(table, columns, order, build = (q) => q) {
        const rows = [];
        for (let from = 0; ; from += PAGE) {
            const data = must(await build(db.from(table).select(columns)).order(order, { ascending: true }).range(from, from + PAGE - 1));
            if (!data || !data.length) break;
            rows.push(...data);
            if (data.length < PAGE) break;
        }
        return rows;
    }

    return {
        mode: 'live',

        async init() {
            if (!window.supabase || !window.supabase.createClient) throw new Error('Supabase 도구를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
            db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        },

        // ----- 로그인 -----
        async currentUser() {
            const { data } = await db.auth.getSession();
            return data.session ? data.session.user : null;
        },
        onAuthChange(cb) {
            db.auth.onAuthStateChange((_event, session) => cb(session ? session.user : null));
        },
        async signIn(email, password) {
            must(await db.auth.signInWithPassword({ email, password }));
        },
        async signOut() {
            await db.auth.signOut();
        },
        async profile(user) {
            const { data } = await db.from('profiles').select('nickname, role').eq('id', user.id).maybeSingle();
            return {
                id: user.id,
                nickname: (data && data.nickname) || (user.user_metadata && user.user_metadata.nickname) || '탐험가',
                role: (data && data.role) || 'member',
            };
        },

        // ----- 학반 -----
        async myClassrooms(user) {
            const classes = must(await db.from('classrooms').select('*').order('created_at', { ascending: false }));
            const mine = must(await db.from('classroom_members').select('classroom_id, team').eq('user_id', user.id));
            return classes.map((c) => {
                const m = mine.find((x) => x.classroom_id === c.id);
                return { ...c, isTeacher: c.teacher_id === user.id, isMember: !!m, myTeam: m ? m.team : null };
            });
        },
        async joinClassroom(code) {
            return must(await db.rpc('join_classroom', { p_code: code }));
        },
        async createClassroom({ name, teamCount }) {
            return must(await db.from('classrooms').insert({ name, team_count: teamCount }).select().single());
        },
        async updateClassroom(id, patch) {
            return must(await db.from('classrooms').update(patch).eq('id', id).select().single());
        },
        async deleteClassroom(id) {
            must(await db.from('classrooms').delete().eq('id', id));
        },
        async members(classroomId) {
            return must(await db.from('classroom_members').select('user_id, nickname, team, joined_at').eq('classroom_id', classroomId).order('joined_at'));
        },
        async setTeam(classroomId, userId, team) {
            must(await db.rpc('set_classroom_team', { p_classroom: classroomId, p_user: userId, p_team: team }));
        },
        async removeMember(classroomId, userId) {
            must(await db.from('classroom_members').delete().eq('classroom_id', classroomId).eq('user_id', userId));
        },

        // ----- 키워드 -----
        async keywords(classroomId) {
            return must(await db.from('classroom_keywords').select('id, text, created_at').eq('classroom_id', classroomId).order('id'));
        },
        async addKeyword(classroomId, text) {
            must(await db.from('classroom_keywords').insert({ classroom_id: classroomId, text }));
        },
        async deleteKeywords(ids) {
            if (ids.length) must(await db.from('classroom_keywords').delete().in('id', ids));
        },
        async classifyKeywords(texts) {
            const { data, error } = await db.functions.invoke('gemini', { body: { task: 'classify_keywords', keywords: texts } });
            if (error) {
                let message = error.message;
                try {
                    message = (await error.context.json()).error || message;
                } catch (_) {
                    /* 그대로 */
                }
                throw new Error(message);
            }
            if (data && data.error) throw new Error(data.error);
            return JSON.parse(data.text).items || [];
        },

        // ----- 포스터·별점 -----
        async posters(classroomId) {
            return must(await db.from('classroom_posters').select('*').eq('classroom_id', classroomId).order('team'));
        },
        // file 이 있으면 새 사진을 올리고 예전 사진은 지움
        async savePoster(classroomId, team, { title, description, file, old }) {
            let image_url = old ? old.image_url : '';
            let image_path = old ? old.image_path : null;
            if (file) {
                const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
                const path = `${classroomId}/${team}/${Date.now()}.${ext}`;
                must(await db.storage.from('classroom-posters').upload(path, file, { contentType: file.type, upsert: false }));
                image_url = db.storage.from('classroom-posters').getPublicUrl(path).data.publicUrl;
                if (image_path) await db.storage.from('classroom-posters').remove([image_path]);
                image_path = path;
            }
            return must(
                await db
                    .from('classroom_posters')
                    .upsert({ classroom_id: classroomId, team, title, description, image_url, image_path, updated_at: new Date().toISOString() }, { onConflict: 'classroom_id,team' })
                    .select()
                    .single()
            );
        },
        async deletePoster(poster) {
            if (poster.image_path) await db.storage.from('classroom-posters').remove([poster.image_path]);
            must(await db.from('classroom_posters').delete().eq('id', poster.id));
        },
        async myRatings(posterIds) {
            if (!posterIds.length) return [];
            return must(await db.from('poster_ratings').select('poster_id, aesthetic, creativity, solving').in('poster_id', posterIds));
        },
        async rate(posterId, scores) {
            must(await db.from('poster_ratings').upsert({ poster_id: posterId, ...scores, updated_at: new Date().toISOString() }, { onConflict: 'poster_id,rater_id' }));
        },
        async results(classroomId) {
            return must(await db.rpc('classroom_poster_results', { p_classroom: classroomId }));
        },

        // ----- 실시간 -----
        subscribe(classroomId, { onClassroom, onKeywords, onPosters, onMembers }) {
            const ch = db
                .channel(`classroom-${classroomId}`)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'classrooms', filter: `id=eq.${classroomId}` }, (p) => onClassroom && onClassroom(p))
                .on('postgres_changes', { event: '*', schema: 'public', table: 'classroom_keywords', filter: `classroom_id=eq.${classroomId}` }, (p) => onKeywords && onKeywords(p))
                .on('postgres_changes', { event: '*', schema: 'public', table: 'classroom_posters', filter: `classroom_id=eq.${classroomId}` }, (p) => onPosters && onPosters(p))
                // 조 배정 (학생은 RLS 때문에 자기 줄의 바뀜만 받음)
                .on('postgres_changes', { event: '*', schema: 'public', table: 'classroom_members', filter: `classroom_id=eq.${classroomId}` }, (p) => onMembers && onMembers(p))
                .subscribe();
            return () => db.removeChannel(ch);
        },

        // ----- 생태지도 기록 (누구나 볼 수 있는 표만 읽기) -----
        async observations() {
            return allRows('observations', 'id, name, scientificName, type, lat, lon, path, date, yearMonth, user_id, imageUrl', 'id');
        },
        async weather() {
            try {
                return await allRows('observation_weather', 'observation_id, status, tavg, tmax', 'observation_id', (q) => q.eq('status', 'ok'));
            } catch (err) {
                console.warn('날씨 표를 읽지 못했어요:', err.message || err);
                return [];
            }
        },
        async memberIds(classroomId) {
            const rows = must(await db.rpc('classroom_member_ids', { p_classroom: classroomId }));
            return rows.map((r) => (typeof r === 'string' ? r : r.classroom_member_ids || Object.values(r)[0]));
        },
        async clans() {
            return must(await db.from('clans').select('id, name').order('name'));
        },
        async clanMemberIds(clanId) {
            return must(await db.from('clan_members').select('user_id').eq('clan_id', clanId)).map((r) => r.user_id);
        },
    };
})();
