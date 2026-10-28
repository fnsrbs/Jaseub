alter table public.seats add column disabled_reason text not null default '' check (length(disabled_reason)<=300);

-- Extend the existing admin-only action; keep its authorization and assignment guard.
do $migration$
declare definition text; original text; replacement text;
begin
 select pg_get_functiondef('public.app_api(text,jsonb,uuid,text)'::regprocedure) into definition;
 original := $old$insert into seats values((p_payload->>'id')::int,(p_payload->>'row')::int,(p_payload->>'col')::int,(p_payload->>'enabled')::boolean) on conflict(id) do update set row=excluded.row,col=excluded.col,enabled=excluded.enabled;return '{}'::jsonb;$old$;
 replacement := $new$
  if not (p_payload->>'enabled')::boolean and length(trim(coalesce(p_payload->>'disabled_reason','')))=0 then raise exception '사용 안 함 사유를 입력하세요.';end if;
  select to_jsonb(se) into old from public.seats se where se.id=(p_payload->>'id')::int;
  insert into seats(id,row,col,enabled,disabled_reason) values((p_payload->>'id')::int,(p_payload->>'row')::int,(p_payload->>'col')::int,(p_payload->>'enabled')::boolean,case when (p_payload->>'enabled')::boolean then '' else trim(coalesce(p_payload->>'disabled_reason','')) end)
  on conflict(id) do update set row=excluded.row,col=excluded.col,enabled=excluded.enabled,disabled_reason=excluded.disabled_reason;
  insert into public.audits(actor,kind,before_value,after_value,reason) select p_admin,'seat',old,to_jsonb(se),case when se.enabled then '좌석 사용 가능' else se.disabled_reason end from public.seats se where se.id=(p_payload->>'id')::int;
  return '{}'::jsonb;
 $new$;
 if position(original in definition)=0 then raise exception 'Seat action definition changed';end if;
 definition := replace(definition,original,replacement);
 definition := replace(definition,'jsonb_agg(to_jsonb(se) order by se.id)','jsonb_agg(case when is_admin then to_jsonb(se) else to_jsonb(se)-''disabled_reason'' end order by se.id)');
 execute definition;
 select pg_get_functiondef('public.teacher_viewer_api(text,jsonb,text)'::regprocedure) into definition;
 definition := replace(definition,'jsonb_agg(to_jsonb(s) order by s.id) from public.seats s','jsonb_agg(to_jsonb(s)-''disabled_reason'' order by s.id) from public.seats s');
 execute definition;
end $migration$;
