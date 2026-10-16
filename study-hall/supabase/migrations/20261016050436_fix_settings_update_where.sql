do $migration$
declare
  definition text;
  old_sql text := 'update settings set capacity=(p_payload->>''capacity'')::int,exam_date=nullif(p_payload->>''exam_date'','''')::date,missing_hours=(p_payload->>''missing_hours'')::int;';
  new_sql text := 'update settings set capacity=(p_payload->>''capacity'')::int,exam_date=nullif(p_payload->>''exam_date'','''')::date,missing_hours=(p_payload->>''missing_hours'')::int where id=true;';
begin
  select pg_get_functiondef('public.app_api(text,jsonb,uuid,text)'::regprocedure) into definition;
  if position(old_sql in definition)=0 then
    raise exception 'Expected settings UPDATE not found; migration aborted';
  end if;
  execute replace(definition, old_sql, new_sql);
end $migration$;
