create table public.supervision_slots (
 day date not null,
 period integer not null check(period between 1 and 7),
 week_label text not null check(length(trim(week_label)) between 1 and 150),
 teacher_name text not null default '' check(length(teacher_name)<=80),
 status text not null check(status in ('assigned','closed','event','unassigned')),
 note text not null default '' check(length(note)<=500),
 revision integer not null default 1 check(revision>0),
 updated_at timestamptz not null default now(),
 primary key(day,period),
 check((status='assigned' and length(trim(teacher_name))>0) or (status<>'assigned' and teacher_name=''))
);
alter table public.supervision_slots enable row level security;
revoke all on public.supervision_slots from public,anon,authenticated;
create policy deny_client on public.supervision_slots as restrictive for all to anon,authenticated using(false) with check(false);
create function public.supervision_api(p_action text,p_payload jsonb default '{}',p_admin uuid default null,p_viewer_session text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare is_admin boolean := p_admin is not null and exists(select 1 from public.admins where user_id=p_admin); cfg public.teacher_viewer_code; item jsonb; old public.supervision_slots; saved public.supervision_slots; changes jsonb := '[]';
begin
 if not is_admin then
  select * into cfg from public.teacher_viewer_code where id=true for share;
  perform 1 from public.teacher_viewer_sessions where token_hash=p_viewer_session and version=cfg.version and expires_at>now() for share;
  if not found then raise exception '교사 또는 관리자 권한이 필요합니다.'; end if;
 end if;
 if p_action='read' then
  return coalesce((select jsonb_agg(to_jsonb(s) order by s.day,s.period) from public.supervision_slots s),'[]'::jsonb);
 end if;
 if not is_admin then raise exception '감독표 수정은 관리자만 가능합니다.'; end if;
 if p_action<>'save' then raise exception '지원하지 않는 요청입니다.'; end if;
 if jsonb_typeof(p_payload->'slots') is distinct from 'array' then raise exception '감독표 항목을 확인하세요.'; end if;
 if jsonb_array_length(p_payload->'slots') not between 1 and 2000 then raise exception '감독표 항목 수를 확인하세요.'; end if;
 if (select count(*)<>count(distinct (x->>'day',x->>'period')) from jsonb_array_elements(p_payload->'slots') x) then raise exception '같은 날짜·교시가 중복되었습니다.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(72178);
 for item in select value from jsonb_array_elements(p_payload->'slots') loop
  if item->>'day' is null or item->>'period' is null then raise exception '날짜·교시가 필요합니다.'; end if;
  select * into old from public.supervision_slots where day=(item->>'day')::date and period=(item->>'period')::int for update;
  if coalesce((item->>'revision')::int,0)<>coalesce(old.revision,0) then raise exception '다른 변경이 있습니다. 다시 조회한 뒤 수정하세요.'; end if;
  insert into public.supervision_slots(day,period,week_label,teacher_name,status,note)
  values((item->>'day')::date,(item->>'period')::int,trim(item->>'week_label'),trim(coalesce(item->>'teacher_name','')),item->>'status',trim(coalesce(item->>'note','')))
  on conflict(day,period) do update set week_label=excluded.week_label,teacher_name=excluded.teacher_name,status=excluded.status,note=excluded.note,revision=public.supervision_slots.revision+1,updated_at=now() returning * into saved;
  changes := changes || jsonb_build_array(jsonb_build_object('before',case when old.day is null then null else to_jsonb(old) end,'after',to_jsonb(saved)));
 end loop;
 insert into public.audits(actor,kind,after_value,reason) values(p_admin,'supervision_save',changes,'감독표 수정');
 return jsonb_build_object('saved',jsonb_array_length(changes));
end $$;
revoke all on function public.supervision_api(text,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.supervision_api(text,jsonb,uuid,text) to service_role;
