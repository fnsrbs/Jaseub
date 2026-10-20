alter table public.operating_days add column is_closed boolean not null default false;
do $patch$
declare definition text;updated text;
begin
 select pg_get_functiondef('public.app_api(text,jsonb,uuid,text)'::regprocedure) into definition;
 updated:=replace(definition,'insert into operating_days values(', 'insert into operating_days(day,start_time,end_time,student_ids,is_closed) values(');
 if updated=definition then raise exception '운영일 저장 함수를 확인하세요.';end if;
 updated:=replace(updated,'::uuid)) on conflict(day)', '::uuid),coalesce((p_payload->>''is_closed'')::boolean,(select d.is_closed from public.operating_days d where d.day=(p_payload->>''day'')::date),false)) on conflict(day)');
 updated:=replace(updated,'student_ids=excluded.student_ids;', 'student_ids=excluded.student_ids,is_closed=excluded.is_closed;');
 if position('p_payload->>''is_closed''' in updated)=0 then raise exception '미운영 저장 항목을 확인하세요.';end if;execute updated;
 select pg_get_functiondef('public.operating_day_end(date)'::regprocedure) into definition;
 updated:=replace(definition,'select end_time from public.operating_days','select case when is_closed then time ''00:00'' else end_time end from public.operating_days');execute updated;
 select pg_get_functiondef('public.schedule_operating_day_checkout()'::regprocedure) into definition;
 updated:=replace(definition,'new.day+new.end_time','new.day+public.operating_day_end(new.day)');execute updated;
 select pg_get_functiondef('public.guard_custom_operating_hours()'::regprocedure) into definition;
 updated:=replace(definition,'::date+end_time','::date+public.operating_day_end((new.entered_at at time zone ''Asia/Seoul'')::date)');execute updated;
end $patch$;
