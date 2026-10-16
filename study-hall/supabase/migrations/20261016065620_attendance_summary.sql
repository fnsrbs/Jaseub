create function public.attendance_summary(p_payload jsonb default '{}',p_admin uuid default null,p_viewer_session text default null,p_student_session text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 allowed boolean:=false; own_id uuid; selected text; first_day date; last_day date; result jsonb;
begin
 if p_student_session is not null then
  select st.id into own_id from public.students st join public.student_sessions ss on ss.student_id=st.id join public.student_codes c on c.student_id=st.id and c.version=ss.version where ss.token_hash=p_student_session and ss.expires_at>now() and st.active and st.deleted_at is null;
  if own_id is null then raise exception '학생 세션이 만료되었습니다.'; end if;
  if nullif(p_payload->>'student_id','') is not null and p_payload->>'student_id'<>own_id::text then raise exception '본인 출결만 조회할 수 있습니다.'; end if;
  selected:=own_id::text;
 else
  select exists(select 1 from public.admins where user_id=p_admin) or exists(select 1 from public.teacher_viewer_sessions s join public.teacher_viewer_code c on c.id=true and c.version=s.version where s.token_hash=p_viewer_session and s.expires_at>now()) into allowed;
  if not allowed then raise exception '로그인이 필요합니다.'; end if;
  selected:=nullif(p_payload->>'student_id','');
 end if;
 first_day:=(p_payload->>'start')::date; last_day:=(p_payload->>'end')::date;
 if first_day is null or last_day is null or first_day>last_day then raise exception '조회 기간을 확인하세요.'; end if;
 with records as materialized (
  select s.day,s.period,e->>'student_id' student_id,e->>'status' status,e->>'note' note
  from public.period_attendance_sessions s cross join lateral jsonb_array_elements(s.entries) e
  where s.confirmed and s.day between first_day and last_day and (selected is null or e->>'student_id'=selected)
 ), counts as (
  select student_id,count(*) filter(where status='present') present,count(*) filter(where status='late') late,count(*) filter(where status='absent') absent,count(*) filter(where status='excused') excused from records group by student_id
 ) select jsonb_build_object('summaries',coalesce((select jsonb_agg(to_jsonb(c)) from counts c),'[]'::jsonb),'total',case when selected is null then 0 else (select count(*) from records) end,'records',case when selected is null then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(r)-'student_id' order by day desc,period desc) from (select * from records order by day desc,period desc limit 100 offset greatest(0,coalesce((p_payload->>'offset')::int,0))) r),'[]'::jsonb) end) into result;
 return result;
end $$;
revoke all on function public.attendance_summary(jsonb,uuid,text,text) from public,anon,authenticated;
grant execute on function public.attendance_summary(jsonb,uuid,text,text) to service_role;

do $menu$
declare definition text;
begin
 select pg_get_functiondef('public.menu_order_api(text,jsonb,uuid,text,text)'::regprocedure) into definition;
 execute replace(definition, 'when ''student'' then array[''home'',''ranking''', 'when ''student'' then array[''home'',''attendance'',''ranking''');
end $menu$;
