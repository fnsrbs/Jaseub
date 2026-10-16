create sequence public.period_attendance_change_seq;
create table public.period_attendance_sessions (
 day date not null,
 period int not null check(period between 1 and 7),
 entries jsonb not null check(jsonb_typeof(entries)='array'),
 confirmed boolean not null default true,
 revision int not null default 1 check(revision>0),
 request_id uuid not null,
 change_id bigint not null default nextval('public.period_attendance_change_seq'),
 updated_at timestamptz not null default now(),
 updated_by text not null,
 synced_revision int not null default 0,
 synced_at timestamptz,
 primary key(day,period)
);
create table public.period_attendance_events (
 id bigint generated always as identity primary key,
 day date not null,
 period int not null,
 actor text not null,
 action text not null,
 reason text not null default '',
 changes jsonb not null,
 created_at timestamptz not null default now()
);
create index period_attendance_events_day_idx on public.period_attendance_events(day,id desc);
alter table public.period_attendance_sessions enable row level security;
alter table public.period_attendance_events enable row level security;
revoke all on public.period_attendance_sessions,public.period_attendance_events from public,anon,authenticated;
revoke all on sequence public.period_attendance_change_seq from public,anon,authenticated;
create policy deny_client on public.period_attendance_sessions as restrictive for all to anon,authenticated using(false) with check(false);
create policy deny_client on public.period_attendance_events as restrictive for all to anon,authenticated using(false) with check(false);

create function public.period_attendance_api(p_action text,p_payload jsonb default '{}',p_admin uuid default null,p_viewer_session text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 is_admin boolean:=p_admin is not null and exists(select 1 from public.admins where user_id=p_admin);
 cfg public.teacher_viewer_code;
 old public.period_attendance_sessions;
 saved public.period_attendance_sessions;
 selected_day date;
 selected_period int;
 actor_name text;
 roster jsonb;
 entries jsonb;
 changes jsonb;
 item jsonb;
 input_entry jsonb;
 sync_cfg public.seat_sheet_sync_config;
 secret_value text;
begin
 if is_admin then actor_name:='admin:'||p_admin;
 else
  select * into cfg from public.teacher_viewer_code where id=true for share;
  perform 1 from public.teacher_viewer_sessions where token_hash=p_viewer_session and version=cfg.version and expires_at>now() for share;
  if not found then raise exception '교사 또는 관리자 권한이 필요합니다.'; end if;
  actor_name:='teacher:'||left(p_viewer_session,12);
 end if;
 if p_payload->>'day' is null then raise exception '날짜가 필요합니다.'; end if;
 selected_day:=(p_payload->>'day')::date;
 if p_action='read' then
  return jsonb_build_object('day',selected_day,'sessions',coalesce((select jsonb_agg(to_jsonb(s) order by s.period) from public.period_attendance_sessions s where s.day=selected_day),'[]'::jsonb),
   'history',case when is_admin then coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from (select * from public.period_attendance_events where day=selected_day order by id desc limit 100)e),'[]'::jsonb) else '[]'::jsonb end,
   'sheet_configured',exists(select 1 from public.seat_sheet_sync_config where id=true and endpoint<>''));
 end if;
 if not is_admin and selected_day<>(now() at time zone 'Asia/Seoul')::date then raise exception '과거·미래 날짜의 출석 변경은 관리자만 가능합니다.'; end if;
 if p_action='sync_payload' then
  select * into sync_cfg from public.seat_sheet_sync_config where id=true;
  if sync_cfg.endpoint is null or sync_cfg.endpoint='' then raise exception '좌석 관리에서 구글 시트 연결을 먼저 완료하세요.'; end if;
  select decrypted_secret into secret_value from vault.decrypted_secrets where id=sync_cfg.secret_id;
  if secret_value is null then raise exception '구글 연결 인증값을 확인하세요.'; end if;
  return jsonb_build_object('endpoint',sync_cfg.endpoint,'secret',secret_value,'spreadsheet_id',sync_cfg.spreadsheet_id,'day',selected_day,
   'generation',coalesce((select max(change_id) from public.period_attendance_sessions where day=selected_day),0),
   'sessions',coalesce((select jsonb_agg(to_jsonb(s) order by s.period) from public.period_attendance_sessions s where s.day=selected_day),'[]'::jsonb));
 end if;
 if p_action='mark_synced' then
  perform pg_catalog.pg_advisory_xact_lock(72185);
  if coalesce((select max(change_id) from public.period_attendance_sessions where day=selected_day),0)<>(p_payload->>'generation')::bigint then raise exception '출석이 변경되어 시트 재반영이 필요합니다.'; end if;
  update public.period_attendance_sessions set synced_revision=revision,synced_at=now() where day=selected_day;
  return jsonb_build_object('synced',true);
 end if;
 if p_action not in ('save','reset') or p_action is null then raise exception '지원하지 않는 요청입니다.'; end if;
 if p_payload->>'period' is null or p_payload->>'revision' is null or p_payload->>'request_id' is null then raise exception '교시·버전·요청 ID가 필요합니다.'; end if;
 selected_period:=(p_payload->>'period')::int;
 if extract(isodow from selected_day) not between 1 and 5 or selected_period not between 1 and (case when extract(isodow from selected_day) in (1,2) then 7 else 6 end) then raise exception '해당 요일에 없는 교시입니다.'; end if;
 if p_action='reset' and not is_admin then raise exception '출석 초기화는 관리자만 가능합니다.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(72185);
 select * into old from public.period_attendance_sessions where day=selected_day and period=selected_period for update;
 if old.request_id=(p_payload->>'request_id')::uuid then return public.period_attendance_api('read',p_payload,p_admin,p_viewer_session); end if;
 if (p_payload->>'revision')::int<>coalesce(old.revision,0) then raise exception '다른 교사가 출석을 변경했습니다. 다시 조회한 뒤 수정하세요.'; end if;
 if p_action='reset' then
  if old.day is null then raise exception '저장된 출석이 없습니다.'; end if;
  if coalesce(length(trim(p_payload->>'reason')),0)=0 then raise exception '초기화 사유를 입력하세요.'; end if;
  update public.period_attendance_sessions set confirmed=false,revision=revision+1,request_id=(p_payload->>'request_id')::uuid,change_id=nextval('public.period_attendance_change_seq'),updated_at=now(),updated_by=actor_name where day=selected_day and period=selected_period;
  insert into public.period_attendance_events(day,period,actor,action,reason,changes) values(selected_day,selected_period,actor_name,'reset',left(trim(p_payload->>'reason'),500),jsonb_build_object('previous_revision',old.revision));
 else
  if old.day is not null then roster:=old.entries;
  else select coalesce(jsonb_agg(jsonb_build_object('student_id',id,'number',number,'name',name,'seat_id',seat_id) order by number),'[]'::jsonb) into roster from public.students where active and deleted_at is null;
  end if;
  if jsonb_typeof(p_payload->'entries') is distinct from 'array' then raise exception '출석 목록이 필요합니다.'; end if;
  if jsonb_array_length(roster)=0 or jsonb_array_length(p_payload->'entries')<>jsonb_array_length(roster) then raise exception '출석 대상 학생이 변경됐습니다. 다시 조회하세요.'; end if;
  if (select count(*)<>count(distinct x->>'student_id') from jsonb_array_elements(p_payload->'entries')x) then raise exception '출석 학생이 중복되었습니다.'; end if;
  entries:='[]'::jsonb;
  changes:='[]'::jsonb;
  for item in select value from jsonb_array_elements(roster) loop
   select value into input_entry from jsonb_array_elements(p_payload->'entries') where value->>'student_id'=item->>'student_id';
   if input_entry is null or input_entry->>'status' is null or input_entry->>'status' not in ('present','late','absent','excused') or length(coalesce(input_entry->>'note',''))>500 then raise exception '학생·출석 상태·사유를 확인하세요.'; end if;
   input_entry:=item || jsonb_build_object('status',input_entry->>'status','note',trim(coalesce(input_entry->>'note','')));
   entries:=entries||jsonb_build_array(input_entry);
   if old.day is null or not old.confirmed or item->>'status' is distinct from input_entry->>'status' or item->>'note' is distinct from input_entry->>'note' then
    changes:=changes||jsonb_build_array(jsonb_build_object('student_id',item->>'student_id','number',item->>'number','name',item->>'name','before',case when old.confirmed then item->>'status' else null end,'after',input_entry->>'status','note',input_entry->>'note'));
   end if;
  end loop;
  insert into public.period_attendance_sessions(day,period,entries,request_id,updated_by) values(selected_day,selected_period,entries,(p_payload->>'request_id')::uuid,actor_name)
  on conflict(day,period) do update set entries=excluded.entries,confirmed=true,revision=public.period_attendance_sessions.revision+1,request_id=excluded.request_id,change_id=nextval('public.period_attendance_change_seq'),updated_at=now(),updated_by=excluded.updated_by returning * into saved;
  insert into public.period_attendance_events(day,period,actor,action,reason,changes) values(selected_day,selected_period,actor_name,'save',case when old.day is null or not old.confirmed then '출석 확인 완료' else '출석 변경' end,changes);
 end if;
 return public.period_attendance_api('read',p_payload,p_admin,p_viewer_session);
end $$;
revoke all on function public.period_attendance_api(text,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.period_attendance_api(text,jsonb,uuid,text) to service_role;

do $menu$
declare definition text;
begin
 select pg_get_functiondef('public.menu_order_api(text,jsonb,uuid,text,text)'::regprocedure) into definition;
 execute replace(definition, 'array[''home'',''ranking'',''supervision''', 'array[''home'',''attendance'',''ranking'',''supervision''');
 update public.role_menu_order set orders=jsonb_set(jsonb_set(orders,'{teacher}',case when coalesce(orders->'teacher','[]'::jsonb) ? 'attendance' then orders->'teacher' else coalesce(orders->'teacher','[]'::jsonb)||'["attendance"]'::jsonb end),'{viewer}',case when coalesce(orders->'viewer','[]'::jsonb) ? 'attendance' then orders->'viewer' else coalesce(orders->'viewer','[]'::jsonb)||'["attendance"]'::jsonb end),revision=revision+1 where id=true;
end $menu$;
