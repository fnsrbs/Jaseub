-- Authentication still runs before the read branch. Valid teacher viewer
-- sessions may read live aggregates; named ballots remain admin-only.
do $poll_results$
declare definition text;
begin
 select pg_get_functiondef('public.poll_api(text,jsonb,uuid,text,text)'::regprocedure) into definition;
 if position('is_admin or p.closed' in definition)=0 then
  raise exception 'Expected poll results gate is missing';
 end if;
 execute replace(definition,'is_admin or p.closed','is_admin or (allowed and p_viewer_session is not null) or p.closed');
end $poll_results$;
