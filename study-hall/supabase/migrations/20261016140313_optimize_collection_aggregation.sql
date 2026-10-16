-- Aggregate the shared daily records once, rather than re-ranking for each student.
create or replace function public.study_collections(p_student uuid default null) returns jsonb
language sql stable security definer set search_path='' as $collections$
 with counts as materialized (
  select r.student_id,
   count(*) filter(where r.kind='crowns') crowns,
   count(*) filter(where r.kind='stars') stars,
   count(*) filter(where r.kind='clovers') clovers
  from public.study_collection_records() r
  where p_student is null or r.student_id=p_student
  group by r.student_id
 )
 select coalesce(jsonb_object_agg(s.id::text,jsonb_build_object(
  'crowns',coalesce(c.crowns,0),'stars',coalesce(c.stars,0),'clovers',coalesce(c.clovers,0)
 )),'{}'::jsonb)
 from public.students s left join counts c on c.student_id=s.id
 where s.active and s.deleted_at is null and (p_student is null or s.id=p_student);
$collections$;
revoke all on function public.study_collections(uuid) from public,anon,authenticated;
grant execute on function public.study_collections(uuid) to service_role;
