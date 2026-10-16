-- Counters are derived from existing records: no extra polling, per-period awards, or duplicate writes.
create or replace function public.study_collections(p_student uuid default null) returns jsonb
language sql stable security definer set search_path='' as $collections$
 with eligible as materialized (select id from public.students where active and deleted_at is null),
 completed as materialized (
  select v.student_id,d.day::date as day,
   floor(sum(extract(epoch from least(v.exited_at,(d.day::date+1)::timestamp at time zone 'Asia/Seoul')-greatest(v.entered_at,d.day::date::timestamp at time zone 'Asia/Seoul'))))::bigint seconds
  from public.visits v join eligible e on e.id=v.student_id
  cross join lateral generate_series((v.entered_at at time zone 'Asia/Seoul')::date::timestamp,(v.exited_at at time zone 'Asia/Seoul')::date::timestamp,interval '1 day') d(day)
  where v.exited_at is not null and v.exited_at<=now() and v.exited_at>v.entered_at
   and extract(isodow from d.day) between 1 and 5
   and now()>=((d.day::date+case when extract(isodow from d.day)<=2 then time '16:30' else time '15:30' end) at time zone 'Asia/Seoul')
   and not exists(select 1 from public.visits o join eligible oe on oe.id=o.student_id where o.exited_at is null and o.entered_at<(d.day::date+1)::timestamp at time zone 'Asia/Seoul')
  group by v.student_id,d.day
 ), ranked as (
  select student_id,day,rank() over(partition by day order by seconds desc) rank from completed where seconds>0
 ), attendance as (
  select v.student_id,(v.entered_at at time zone 'Asia/Seoul')::date as day from public.visits v join eligible e on e.id=v.student_id
   where v.entered_at<=now() and (p_student is null or v.student_id=p_student)
  union
  select e.id,s.day from public.period_attendance_sessions s cross join lateral jsonb_array_elements(s.entries) a
   join eligible e on e.id::text=a->>'student_id'
   where s.confirmed and s.day<=(now() at time zone 'Asia/Seoul')::date and a->>'status' in ('present','late') and (p_student is null or e.id=p_student)
 )
 select coalesce(jsonb_object_agg(e.id::text,jsonb_build_object(
  'crowns',(select count(*) from ranked r where r.student_id=e.id and rank=1),
  'stars',(select count(*) from ranked r where r.student_id=e.id and rank between 2 and 5),
  'clovers',(select count(*) from attendance a where a.student_id=e.id)
 )),'{}'::jsonb) from eligible e where p_student is null or e.id=p_student;
$collections$;
revoke all on function public.study_collections(uuid) from public,anon,authenticated;
grant execute on function public.study_collections(uuid) to service_role;

create or replace function public.study_ranking(p_scope text default 'week',p_admin uuid default null,p_viewer_session text default null,p_student_session text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare teacher boolean:=p_admin is not null and exists(select 1 from public.admins where user_id=p_admin); student_id uuid; today date:=(now() at time zone 'Asia/Seoul')::date; monday date; friday date; first_day date; last_day date; result jsonb; collections jsonb;
begin
 if p_scope is null or p_scope not in ('day','week') then raise exception '순위 조회 기간을 확인하세요.'; end if;
 if not teacher and p_viewer_session is not null then
  select exists(select 1 from public.teacher_viewer_sessions s join public.teacher_viewer_code c on c.id=true and c.version=s.version where s.token_hash=p_viewer_session and s.expires_at>now()) into teacher;
 end if;
 if not teacher then
  select st.id into student_id from public.students st join public.student_sessions ss on ss.student_id=st.id join public.student_codes c on c.student_id=st.id and c.version=ss.version where ss.token_hash=p_student_session and ss.expires_at>now() and st.active and st.deleted_at is null;
  if student_id is null then raise exception '로그인이 필요합니다.'; end if;
 end if;
 monday:=today-(extract(isodow from today)::int-1);friday:=monday+4;
 first_day:=case when p_scope='day' then today else monday end;
 last_day:=case when p_scope='day' then today else friday end;
 collections:=public.study_collections(case when teacher then null else student_id end);
 with days as(select (first_day+i)::timestamp at time zone 'Asia/Seoul' starts,(first_day+i+1)::timestamp at time zone 'Asia/Seoul' ends from generate_series(0,last_day-first_day) i where first_day+i<=today),
 scores as(select s.id,s.name,s.number,coalesce((select floor(sum(extract(epoch from least(v.exited_at,d.ends)-greatest(v.entered_at,d.starts)))) from public.visits v join days d on v.entered_at<d.ends and v.exited_at>d.starts where v.student_id=s.id and v.exited_at is not null and v.exited_at<=now()),0)::bigint seconds from public.students s where s.active and s.deleted_at is null),
 ranked as(select *,case when seconds>0 then rank() over(order by seconds desc) else null end rank,case when seconds>0 then count(*) over(partition by seconds) else 0 end tied_count,case when seconds>0 then max(seconds) over()-seconds else null end leader_gap_seconds from scores)
 select jsonb_build_object('scope',p_scope,'period_start',first_day,'period_end',last_day,'participants',(select count(*) from scores where seconds>0),'eligible',(select count(*) from scores),'average_seconds',coalesce((select floor(avg(seconds))::bigint from scores where seconds>0),0)) ||
  case when teacher then jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'number',r.number,'rank',r.rank,'seconds',r.seconds,'tied',r.tied_count>1,'tied_count',r.tied_count,'leader_gap_seconds',r.leader_gap_seconds,'collection',collections->r.id::text) order by r.seconds desc,r.number) from ranked r),'[]'::jsonb))
  else jsonb_build_object('mine',(select jsonb_build_object('rank',r.rank,'seconds',r.seconds,'tied',r.tied_count>1,'tied_count',r.tied_count,'leader_gap_seconds',r.leader_gap_seconds,'collection',collections->r.id::text) from ranked r where r.id=student_id)) end into result;
 return result;
end $$;
revoke all on function public.study_ranking(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.study_ranking(text,uuid,text,text) to service_role;
create or replace function public.study_clovers(p_student uuid) returns bigint
language sql stable security definer set search_path='' as $clovers$
 select count(*) from (
  select (v.entered_at at time zone 'Asia/Seoul')::date as day from public.visits v where v.student_id=p_student and v.entered_at<=now()
  union
  select s.day from public.period_attendance_sessions s cross join lateral jsonb_array_elements(s.entries) e
   where s.confirmed and s.day<=(now() at time zone 'Asia/Seoul')::date and e->>'student_id'=p_student::text and e->>'status' in ('present','late')
 ) days;
$clovers$;
revoke all on function public.study_clovers(uuid) from public,anon,authenticated;
grant execute on function public.study_clovers(uuid) to service_role;

do $snapshot$
declare definition text;
begin
 select pg_get_functiondef('public.snapshot_with_warnings(uuid,text,text)'::regprocedure) into definition;
 if position('return result ||' in definition)=0 then raise exception '학생 화면 조회 함수를 확인하세요.'; end if;
 execute replace(definition,'return result ||','if p_session is not null then result:=result||jsonb_build_object(''clovers'',public.study_clovers((result->''students''->0->>''id'')::uuid)); end if; return result ||');
end $snapshot$;

