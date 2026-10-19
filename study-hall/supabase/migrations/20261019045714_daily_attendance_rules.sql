create or replace function public.attendance_daily_source(p_payload jsonb default '{}',p_admin uuid default null,p_viewer_session text default null,p_student_session text default null)
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

 with records as (
  select s.day,s.period,e->>'student_id' student_id,e->>'status' status,coalesce(e->>'note','') note,coalesce(e->>'exempt_reason','') exempt_reason
  from public.period_attendance_sessions s cross join lateral jsonb_array_elements(s.entries)e
  where (s.confirmed or e->>'confirmed'='true') and s.day<=(now() at time zone 'Asia/Seoul')::date
   and (selected is null or e->>'student_id'=selected)
 ), days as (
  select day,student_id,jsonb_agg(jsonb_build_object('period',period,'status',status,'note',note,'exempt_reason',exempt_reason) order by period) entries from records group by day,student_id
 ), source as (
  select d.*, (select case when bool_or(v.exited_at is null) then null else max(v.exited_at) end from public.visits v
   where v.student_id=d.student_id::uuid and v.entered_at>=(d.day::timestamp at time zone 'Asia/Seoul') and v.entered_at<((d.day+1)::timestamp at time zone 'Asia/Seoul')) last_exit from days d
 ) select jsonb_build_object('daily_source',coalesce((select jsonb_agg(to_jsonb(s)) from source s),'[]'::jsonb),'selected',selected,'server_now',now()) into result;
 return result;
end $$;
revoke all on function public.attendance_daily_source(jsonb,uuid,text,text) from public,anon,authenticated;
grant execute on function public.attendance_daily_source(jsonb,uuid,text,text) to service_role;

do $patch$
declare definition text; updated text;
begin
 select pg_get_functiondef('public.period_attendance_api(text,jsonb,uuid,text)'::regprocedure) into definition;
 updated:=replace(definition,'''note'',trim(coalesce(input_entry->>''note'','''')))', '''note'',trim(coalesce(input_entry->>''note'','''')),''exempt_reason'',case when input_entry->>''status''=''excused'' then left(trim(coalesce(input_entry->>''exempt_reason'',item->>''exempt_reason'','''')),200) else '''' end)');
 if updated=definition then raise exception '출결 사유 저장 함수를 확인하세요.';end if;
 updated:=replace(updated,'or item->>''note'' is distinct from input_entry->>''note'' then','or item->>''note'' is distinct from input_entry->>''note'' or coalesce(item->>''exempt_reason'','''') is distinct from coalesce(input_entry->>''exempt_reason'','''') then');
 updated:=replace(updated,'''note'',input_entry->>''note''))','''note'',input_entry->>''note'',''exempt_reason'',input_entry->>''exempt_reason''))');
 execute updated;
 select pg_get_functiondef('public.period_attendance_bulk(jsonb,uuid,text)'::regprocedure) into definition;
 updated:=replace(definition,'''note'',note,''confirmed'',true)', '''note'',note,''confirmed'',true,''exempt_reason'',case when status=''excused'' then left(trim(coalesce(p_payload->>''exempt_reason'',before_entry->>''exempt_reason'','''')),200) else '''' end)');
 if updated=definition then raise exception '여러 교시 사유 저장 함수를 확인하세요.';end if;
 updated:=replace(updated,'''after'',status,''note'',note))','''after'',status,''note'',note,''exempt_reason'',case when status=''excused'' then coalesce(p_payload->>''exempt_reason'',before_entry->>''exempt_reason'','''') else '''' end))');
 execute updated;
end $patch$;
