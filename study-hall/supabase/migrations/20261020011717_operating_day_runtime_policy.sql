-- Date-specific end times override weekday defaults; the entry cutoff remains a lateness reference.
create function public.operating_day_end(p_day date) returns time language sql stable security definer set search_path='' as $$
 select coalesce((select end_time from public.operating_days where day=p_day),case when extract(isodow from p_day) in (1,2) then time '16:30' else time '15:30' end);
$$;
create function public.attendance_period_count(p_day date) returns integer language sql stable security definer set search_path='' as $$
 select case when extract(isodow from p_day) not between 1 and 5 or exists(select 1 from public.operating_days where day=p_day and cardinality(student_ids)=0) then 0 else
 (select count(*)::int from unnest(array[time '08:50',time '09:50',time '10:50',time '11:50',time '13:40',time '14:40',time '15:40']) with ordinality t(starts,n)
 where starts<public.operating_day_end(p_day) and n<=case when extract(isodow from p_day)<=2 then 7 else 6 end) end;
$$;
create function public.attendance_target(p_student uuid,p_day date) returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.operating_days where day=p_day) or exists(select 1 from public.operating_days where day=p_day and p_student=any(student_ids));
$$;
revoke all on function public.operating_day_end(date),public.attendance_period_count(date),public.attendance_target(uuid,date) from public,anon,authenticated;
grant execute on function public.operating_day_end(date),public.attendance_period_count(date),public.attendance_target(uuid,date) to service_role;

create function public.operating_attendance_roster(p_day date,p_old jsonb) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(coalesce((select e from jsonb_array_elements(coalesce(p_old,'[]'::jsonb))e where e->>'student_id'=s.id::text),jsonb_build_object('student_id',s.id,'number',s.number,'name',s.name,'seat_id',s.seat_id,'status',case when p_day=(now() at time zone 'Asia/Seoul')::date and exists(select 1 from public.visits v where v.student_id=s.id and v.exited_at is null) then 'present' else 'absent' end,'note','')) order by s.number),'[]'::jsonb) from public.students s where s.active and s.deleted_at is null and public.attendance_target(s.id,p_day);
$$;
revoke all on function public.operating_attendance_roster(date,jsonb) from public,anon,authenticated;
grant execute on function public.operating_attendance_roster(date,jsonb) to service_role;

create or replace function public.weekday_auto_checkout(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path='' as $$
declare local_day date:=(p_now at time zone 'Asia/Seoul')::date; cutoff timestamptz; closed_ids uuid[]; edits jsonb;
begin
 if extract(isodow from local_day) not between 1 and 5 and not exists(select 1 from public.operating_days where day=local_day) then return 0;end if;
 cutoff:=(local_day+public.operating_day_end(local_day)) at time zone 'Asia/Seoul';
 if p_now<cutoff then return 0;end if;
 perform pg_catalog.pg_advisory_xact_lock(72186);
 with candidates as materialized (
  select id,entered_at,exited_at from public.visits where entered_at<=p_now and (exited_at is null or
   (exists(select 1 from public.operating_days where day=local_day) and entered_at>=(local_day::timestamp at time zone 'Asia/Seoul') and exited_at>greatest(cutoff,entered_at))) for update
 ), updated as (
  update public.visits v set exited_at=greatest(cutoff,v.entered_at) from candidates c where v.id=c.id returning v.id,c.exited_at before_exit,v.exited_at after_exit
 ) select coalesce(array_agg(id),'{}'::uuid[]),coalesce(jsonb_agg(jsonb_build_object('visit_id',id,'before',before_exit,'after',after_exit)),'[]'::jsonb) into closed_ids,edits from updated;
 if cardinality(closed_ids)>0 or not exists(select 1 from public.auto_checkout_runs where day=local_day and recorded_exit_at=cutoff) then
  insert into public.auto_checkout_runs(day,scheduled_at,recorded_exit_at,processed_at,visit_ids,corrections) values(local_day,cutoff,cutoff,p_now,closed_ids,edits)
  on conflict(day) do update set scheduled_at=cutoff,recorded_exit_at=cutoff,processed_at=p_now,visit_ids=array(select distinct unnest(public.auto_checkout_runs.visit_ids||excluded.visit_ids)),corrections=public.auto_checkout_runs.corrections||excluded.corrections;
 end if;
 return cardinality(closed_ids);
end $$;
revoke all on function public.weekday_auto_checkout(timestamptz) from public,anon,authenticated,service_role;

create function public.run_operating_day_checkout(p_day date) returns void language plpgsql security definer set search_path='' as $$
begin
 if p_day=(now() at time zone 'Asia/Seoul')::date then perform public.weekday_auto_checkout();end if;
 perform cron.unschedule(jobid) from cron.job where jobname='study-hall-custom-checkout-'||p_day;
end $$;
create function public.schedule_operating_day_checkout() returns trigger language plpgsql security definer set search_path='' as $$
declare cutoff timestamptz; utc_end timestamp;
begin
 perform cron.unschedule(jobid) from cron.job where jobname='study-hall-custom-checkout-'||new.day;
 if tg_op='UPDATE' and new.student_ids is distinct from old.student_ids then
  update public.period_attendance_sessions set confirmed=false,revision=revision+1,change_id=nextval('public.period_attendance_change_seq'),updated_at=now(),updated_by='system:operating_day' where day=new.day;
 end if;

 cutoff:=(new.day+new.end_time) at time zone 'Asia/Seoul';
 if cutoff<=now() then
  if new.day=(now() at time zone 'Asia/Seoul')::date then perform public.weekday_auto_checkout();end if;
 else
  utc_end:=cutoff at time zone 'UTC';
  perform cron.schedule('study-hall-custom-checkout-'||new.day,extract(minute from utc_end)||' '||extract(hour from utc_end)||' '||extract(day from utc_end)||' '||extract(month from utc_end)||' *',format('select public.run_operating_day_checkout(%L::date);',new.day));
 end if;
 return new;
end $$;
create trigger operating_day_checkout_schedule after insert or update on public.operating_days for each row execute function public.schedule_operating_day_checkout();
create function public.guard_custom_operating_hours() returns trigger language plpgsql security definer set search_path='' as $$
declare cutoff timestamptz;
begin
 select ((new.entered_at at time zone 'Asia/Seoul')::date+end_time) at time zone 'Asia/Seoul' into cutoff from public.operating_days where day=(new.entered_at at time zone 'Asia/Seoul')::date;
 if cutoff is not null and new.exited_at is null and now()>=cutoff then
  if new.entered_at>=cutoff then raise exception '오늘 자습실 운영이 종료되어 입실할 수 없습니다.';end if;
  new.exited_at:=cutoff;
 end if;return new;
end $$;
create trigger custom_operating_hours before insert or update of entered_at,exited_at on public.visits for each row execute function public.guard_custom_operating_hours();
revoke all on function public.run_operating_day_checkout(date),public.schedule_operating_day_checkout(),public.guard_custom_operating_hours() from public,anon,authenticated,service_role;

-- Apply the same date policy to attendance writes, daily summaries and clovers.
do $patch$
declare definition text;updated text;
begin
 select pg_get_functiondef('public.period_attendance_api(text,jsonb,uuid,text)'::regprocedure) into definition;
 definition:=replace(definition,'''day'',selected_day,''sessions''','''day'',selected_day,''operating_day'',(select to_jsonb(o) from public.operating_days o where o.day=selected_day),''sessions''');
 definition:=replace(definition,',''day'',selected_day,',',''day'',selected_day,''operating_day'',(select to_jsonb(o) from public.operating_days o where o.day=selected_day),');
 definition:=replace(definition,'selected_period not between 1 and (case when extract(isodow from selected_day) in (1,2) then 7 else 6 end)','selected_period not between 1 and public.attendance_period_count(selected_day)');
 definition:=replace(definition,'if jsonb_typeof(p_payload->''entries'')','if exists(select 1 from public.operating_days where day=selected_day) then roster:=public.operating_attendance_roster(selected_day,roster);end if; if jsonb_typeof(p_payload->''entries'')');
 definition:=replace(definition,'where active and deleted_at is null','where active and deleted_at is null and public.attendance_target(id,selected_day)');
 execute definition;
 select pg_get_functiondef('public.period_attendance_bulk(jsonb,uuid,text)'::regprocedure) into definition;
 definition:=replace(definition,'case when extract(isodow from selected_day) in (1,2) then 7 when extract(isodow from selected_day) between 3 and 5 then 6 else 0 end','public.attendance_period_count(selected_day)');
 definition:=replace(definition,'if not exists(select 1 from public.students where id=student','if not public.attendance_target(student,selected_day) then raise exception ''출석 대상 학생이 아닙니다.'';end if; if not exists(select 1 from public.students where id=student');
 definition:=replace(definition,'select e into before_entry','if exists(select 1 from public.operating_days where day=selected_day) then roster:=public.operating_attendance_roster(selected_day,roster);end if; select e into before_entry');
 definition:=replace(definition,'where s.active and s.deleted_at is null','where s.active and s.deleted_at is null and public.attendance_target(s.id,selected_day)');execute definition;
 select pg_get_functiondef('public.checkin_from_period_attendance()'::regprocedure) into definition;
 definition:=replace(definition,$old$new.day+case when extract(isodow from new.day) in (1,2) then time '16:30' else time '15:30' end$old$,'new.day+public.operating_day_end(new.day)');execute definition;
 select pg_get_functiondef('public.attendance_daily_source(jsonb,uuid,text,text)'::regprocedure) into definition;
 definition:=replace(definition,'and (selected is null or e->>''student_id''=selected)','and (selected is null or e->>''student_id''=selected) and public.attendance_target((e->>''student_id'')::uuid,s.day) and s.period<=public.attendance_period_count(s.day)');
 definition:=replace(definition,'select d.*,','select d.*, public.attendance_period_count(d.day) period_count, public.operating_day_end(d.day) end_time,');execute definition;
 select pg_get_functiondef('public.full_attendance_days()'::regprocedure) into definition;
 definition:=replace(definition,'case when extract(isodow from s.day)<=2 then 7 else 6 end','public.attendance_period_count(s.day)');
 definition:=replace(definition,'and extract(isodow from s.day) between 1 and 5','and extract(isodow from s.day) between 1 and 5 and public.attendance_period_count(s.day)>0 and public.attendance_target(st.id,s.day)');execute definition;
 select pg_get_functiondef('public.study_collection_records()'::regprocedure) into definition;
 definition:=replace(definition,$old$d.day::date+case when extract(isodow from d.day)<=2 then time '16:30' else time '15:30' end$old$,'d.day::date+public.operating_day_end(d.day::date)');execute definition;
end $patch$;

-- Seed jobs for already-saved future operations; apply today's saved cutoff once.
do $jobs$
declare operation record;utc_end timestamp;
begin
 for operation in select * from public.operating_days where ((day+end_time) at time zone 'Asia/Seoul')>now() loop
  utc_end:=((operation.day+operation.end_time) at time zone 'Asia/Seoul') at time zone 'UTC';
  perform cron.schedule('study-hall-custom-checkout-'||operation.day,extract(minute from utc_end)||' '||extract(hour from utc_end)||' '||extract(day from utc_end)||' '||extract(month from utc_end)||' *',format('select public.run_operating_day_checkout(%L::date);',operation.day));
 end loop;
 perform public.weekday_auto_checkout();
end $jobs$;
