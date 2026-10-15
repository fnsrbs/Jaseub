create function public.weekly_ranking(p_admin uuid default null,p_viewer_session text default null,p_student_session text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare teacher boolean:=p_admin is not null and exists(select 1 from public.admins where user_id=p_admin); student_id uuid; today date:=(now() at time zone 'Asia/Seoul')::date; monday date; friday date; result jsonb;
begin
 if not teacher and p_viewer_session is not null then
  select exists(select 1 from public.teacher_viewer_sessions s join public.teacher_viewer_code c on c.id=true and c.version=s.version where s.token_hash=p_viewer_session and s.expires_at>now()) into teacher;
 end if;
 if not teacher then
  select st.id into student_id from public.students st join public.student_sessions ss on ss.student_id=st.id join public.student_codes c on c.student_id=st.id and c.version=ss.version where ss.token_hash=p_student_session and ss.expires_at>now() and st.active and st.deleted_at is null;
  if student_id is null then raise exception '로그인이 필요합니다.';end if;
 end if;
 monday:=today-(extract(isodow from today)::int-1);friday:=monday+4;
 with days as(select (monday+i)::timestamp at time zone 'Asia/Seoul' starts,(monday+i+1)::timestamp at time zone 'Asia/Seoul' ends from generate_series(0,4) i where monday+i<=today),
 scores as(select s.id,s.name,s.number,coalesce((select floor(sum(extract(epoch from least(v.exited_at,d.ends)-greatest(v.entered_at,d.starts)))) from public.visits v join days d on v.entered_at<d.ends and v.exited_at>d.starts where v.student_id=s.id and v.exited_at is not null and v.exited_at<=now()),0)::bigint seconds from public.students s where s.active and s.deleted_at is null),
 ranked as(select *,case when seconds>0 then rank() over(order by seconds desc) else null end rank,case when seconds>0 then count(*) over(partition by seconds)>1 else false end tied from scores)
 select jsonb_build_object('week_start',monday,'week_end',friday,'participants',(select count(*) from scores where seconds>0),'eligible',(select count(*) from scores)) ||
  case when teacher then jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'number',r.number,'rank',r.rank,'seconds',r.seconds,'tied',r.tied) order by r.seconds desc,r.number) from ranked r),'[]'::jsonb))
  else jsonb_build_object('mine',(select jsonb_build_object('rank',r.rank,'seconds',r.seconds,'tied',r.tied) from ranked r where r.id=student_id)) end into result;
 return result;
end $$;
revoke all on function public.weekly_ranking(uuid,text,text) from public,anon,authenticated;
grant execute on function public.weekly_ranking(uuid,text,text) to service_role;
