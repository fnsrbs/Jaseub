-- Read existing award dates on demand; no additional scheduled jobs or history writes.
create or replace function public.study_collection_records()
returns table(student_id uuid,day date,kind text,rank bigint,seconds bigint)
language sql stable security definer set search_path='' as $records$
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
  select student_id,day,seconds,rank() over(partition by day order by seconds desc) rank from completed where seconds>0
 ), attendance as (
  select v.student_id,(v.entered_at at time zone 'Asia/Seoul')::date as day from public.visits v join eligible e on e.id=v.student_id
   where v.entered_at<=now()
  union
  select e.id,s.day from public.period_attendance_sessions s cross join lateral jsonb_array_elements(s.entries) a
   join eligible e on e.id::text=a->>'student_id'
   where s.confirmed and s.day<=(now() at time zone 'Asia/Seoul')::date and a->>'status' in ('present','late')
 )

 select student_id,day,'crowns'::text,rank,seconds from ranked where rank=1
 union all select student_id,day,'stars'::text,rank,seconds from ranked where rank between 2 and 5
 union all select student_id,day,'clovers'::text,null::bigint,null::bigint from attendance;
$records$;
revoke all on function public.study_collection_records() from public,anon,authenticated;
grant execute on function public.study_collection_records() to service_role;

create or replace function public.collection_history(p_kind text,p_student uuid default null,p_offset integer default 0,p_admin uuid default null,p_viewer_session text default null,p_student_session text default null)
returns jsonb language plpgsql security definer set search_path='' as $history$
declare staff boolean:=false; own_id uuid; selected uuid; result jsonb;
begin
 if p_kind is null or p_kind not in ('crowns','stars','clovers') then raise exception '수집 기록 종류를 확인하세요.'; end if;
 select exists(select 1 from public.admins where user_id=p_admin) or exists(select 1 from public.teacher_viewer_sessions s join public.teacher_viewer_code c on c.id=true and c.version=s.version where s.token_hash=p_viewer_session and s.expires_at>now()) into staff;
 if staff then
  selected:=p_student;
  if selected is null or not exists(select 1 from public.students where id=selected and active and deleted_at is null) then raise exception '학생을 확인하세요.'; end if;
 else
  select st.id into own_id from public.students st join public.student_sessions ss on ss.student_id=st.id join public.student_codes c on c.student_id=st.id and c.version=ss.version where ss.token_hash=p_student_session and ss.expires_at>now() and st.active and st.deleted_at is null;
  if own_id is null then raise exception '로그인이 필요합니다.'; end if;
  if p_student is not null and p_student<>own_id then raise exception '본인 수집 기록만 조회할 수 있습니다.'; end if;
  selected:=own_id;
 end if;
 with records as materialized (select day,rank,seconds from public.study_collection_records() where student_id=selected and kind=p_kind)
 select jsonb_build_object('kind',p_kind,'total',(select count(*) from records),'records',coalesce((select jsonb_agg(to_jsonb(r) order by day desc) from (select * from records order by day desc limit 50 offset greatest(0,coalesce(p_offset,0))) r),'[]'::jsonb)) into result;
 return result;
end $history$;
revoke all on function public.collection_history(text,uuid,integer,uuid,text,text) from public,anon,authenticated;
grant execute on function public.collection_history(text,uuid,integer,uuid,text,text) to service_role;
