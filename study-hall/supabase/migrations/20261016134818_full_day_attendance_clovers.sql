-- A clover requires every scheduled period to be confirmed present, never a QR visit alone.
create or replace function public.full_attendance_days() returns table(student_id uuid,day date)
language sql stable security definer set search_path='' as $days$
 select st.id,s.day
 from public.period_attendance_sessions s cross join lateral jsonb_array_elements(s.entries) e
 join public.students st on st.id::text=e->>'student_id' and st.active and st.deleted_at is null
 where s.confirmed and s.day<=(now() at time zone 'Asia/Seoul')::date
  and extract(isodow from s.day) between 1 and 5
  and s.period between 1 and case when extract(isodow from s.day)<=2 then 7 else 6 end
 group by st.id,s.day
 having count(distinct s.period)=case when extract(isodow from s.day)<=2 then 7 else 6 end
  and bool_and(coalesce(e->>'status','')='present');
$days$;
revoke all on function public.full_attendance_days() from public,anon,authenticated;
grant execute on function public.full_attendance_days() to service_role;

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
 ), attendance as (select student_id,day from public.full_attendance_days())
 select coalesce(jsonb_object_agg(e.id::text,jsonb_build_object(
  'crowns',(select count(*) from ranked r where r.student_id=e.id and rank=1),
  'stars',(select count(*) from ranked r where r.student_id=e.id and rank between 2 and 5),
  'clovers',(select count(*) from attendance a where a.student_id=e.id)
 )),'{}'::jsonb) from eligible e where p_student is null or e.id=p_student;
$collections$;
revoke all on function public.study_collections(uuid) from public,anon,authenticated;
grant execute on function public.study_collections(uuid) to service_role;

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
 ), attendance as (select student_id,day from public.full_attendance_days())

 select student_id,day,'crowns'::text,rank,seconds from ranked where rank=1
 union all select student_id,day,'stars'::text,rank,seconds from ranked where rank between 2 and 5
 union all select student_id,day,'clovers'::text,null::bigint,null::bigint from attendance;
$records$;
revoke all on function public.study_collection_records() from public,anon,authenticated;
grant execute on function public.study_collection_records() to service_role;


create or replace function public.study_clovers(p_student uuid) returns bigint
language sql stable security definer set search_path='' as $clovers$
 select count(*) from public.full_attendance_days() where student_id=p_student;
$clovers$;
revoke all on function public.study_clovers(uuid) from public,anon,authenticated;
grant execute on function public.study_clovers(uuid) to service_role;
