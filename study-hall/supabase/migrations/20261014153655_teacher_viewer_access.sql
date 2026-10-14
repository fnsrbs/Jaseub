create table public.teacher_viewer_code(id boolean primary key default true check(id),code_hash text not null,version int not null default 1);
create table public.teacher_viewer_sessions(token_hash text primary key,version int not null,expires_at timestamptz not null);
alter table public.teacher_viewer_code enable row level security;
alter table public.teacher_viewer_sessions enable row level security;
revoke all on public.teacher_viewer_code,public.teacher_viewer_sessions from public,anon,authenticated;
create policy deny_client on public.teacher_viewer_code as restrictive for all to anon,authenticated using(false) with check(false);
create policy deny_client on public.teacher_viewer_sessions as restrictive for all to anon,authenticated using(false) with check(false);

create function public.teacher_access(p_admin uuid,p_rotate boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare secret_id uuid; code_value text;
begin
 if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then raise exception '관리자 권한이 필요합니다.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(72174);
 select id,decrypted_secret into secret_id,code_value from vault.decrypted_secrets where name='study_hall_teacher_viewer_code';
 if secret_id is null or p_rotate then
  code_value := 'TV-' || upper(encode(extensions.gen_random_bytes(16),'hex'));
  if secret_id is null then perform vault.create_secret(code_value,'study_hall_teacher_viewer_code','Read-only teacher access code');
  else perform vault.update_secret(secret_id,code_value); end if;
  insert into public.teacher_viewer_code(id,code_hash) values(true,public.code_digest(code_value))
   on conflict(id) do update set code_hash=excluded.code_hash,version=public.teacher_viewer_code.version+1;
  delete from public.teacher_viewer_sessions;
  insert into public.audits(actor,kind,reason) values(p_admin,'teacher_code','교사 조회 전용 코드 발급');
 end if;
 return jsonb_build_object('code',code_value,'role','viewer');
end $$;

create function public.teacher_viewer_api(p_action text,p_payload jsonb default '{}',p_session text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.teacher_viewer_code; expiry timestamptz;
begin
 select * into cfg from public.teacher_viewer_code where id=true for share;
 if p_action='login' then
  if cfg.id is null or cfg.code_hash is distinct from p_payload->>'code_hash' then raise exception '교사용 코드를 확인하세요.'; end if;
  if coalesce(p_payload->>'token_hash','') !~ '^[a-f0-9]{64}$' then raise exception '세션 형식 오류'; end if;
  expiry := now()+interval '8 hours';
  delete from public.teacher_viewer_sessions where expires_at<now();
  insert into public.teacher_viewer_sessions values(p_payload->>'token_hash',cfg.version,expiry);
  return jsonb_build_object('role','viewer','expires_at',expiry);
 end if;
 if not exists(select 1 from public.teacher_viewer_sessions where token_hash=p_session and version=cfg.version and expires_at>now()) then raise exception '교사 세션이 만료되었거나 코드가 재발급되었습니다.'; end if;
 if p_action='logout' then delete from public.teacher_viewer_sessions where token_hash=p_session; return '{}'::jsonb; end if;
 if p_action<>'snapshot' then raise exception '교사는 조회만 가능합니다.'; end if;
 return jsonb_build_object(
  'students',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'number',s.number,'seat_id',s.seat_id,'active',s.active) order by s.number) from public.students s),'[]'::jsonb),
  'seats',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.seats s),'[]'::jsonb),
  'visits',coalesce((select jsonb_agg(to_jsonb(v) order by v.entered_at desc) from public.visits v),'[]'::jsonb),
  'notices',coalesce((select jsonb_agg(to_jsonb(n) order by n.important desc,n.created_at desc) from public.notices n),'[]'::jsonb),
  'settings',(select to_jsonb(s)-'id' from public.settings s),
  'operating_days',coalesce((select jsonb_agg(to_jsonb(d)) from public.operating_days d),'[]'::jsonb),
  'suggestions',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc) from public.suggestions s),'[]'::jsonb),'audits','[]'::jsonb,'server_now',now(),
  'current',(select count(*) from public.visits where exited_at is null),
  'today',(select count(distinct student_id) from public.visits where entered_at>=(date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'))
 );
end $$;
revoke all on function public.teacher_access(uuid,boolean),public.teacher_viewer_api(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.teacher_access(uuid,boolean),public.teacher_viewer_api(text,jsonb,text) to service_role;

