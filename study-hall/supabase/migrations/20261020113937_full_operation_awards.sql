-- Rewards require a full regular school day; custom shortened hours never lower this bar.
create function public.collection_day_eligible(p_day date) returns boolean
language sql stable security definer set search_path='' as $$
 select extract(isodow from p_day) between 1 and 5
 and not exists(select 1 from public.operating_days o where o.day=p_day and
 (o.is_closed or cardinality(o.student_ids)=0 or o.start_time>time '08:50'
 or o.end_time<case when extract(isodow from p_day)<=2 then time '16:30' else time '15:30' end));
$$;
revoke all on function public.collection_day_eligible(date) from public,anon,authenticated;
grant execute on function public.collection_day_eligible(date) to service_role;
do $patch$
declare original text; updated text;
begin
 select pg_get_functiondef('public.full_attendance_days()'::regprocedure) into original;
 updated:=replace(original,'where (s.confirmed', 'where public.collection_day_eligible(s.day) and (s.confirmed');
 if updated=original then raise exception 'Attendance reward patch did not match';end if;
 execute updated;
 select pg_get_functiondef('public.study_collection_records()'::regprocedure) into original;
 updated:=replace(original,'where v.exited_at is not null','where public.collection_day_eligible(d.day::date) and public.attendance_target(v.student_id,d.day::date) and v.exited_at is not null');
 if updated=original then raise exception 'Ranking reward patch did not match';end if;
 execute updated;
end $patch$;
