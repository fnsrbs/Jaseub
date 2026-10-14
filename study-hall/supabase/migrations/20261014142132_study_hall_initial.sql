create extension if not exists pgcrypto with schema extensions;
create table public.admins(user_id uuid primary key references auth.users(id));
create table public.settings(id boolean primary key default true check(id),capacity int not null default 72 check(capacity between 1 and 1000),exam_date date,missing_hours int not null default 16 check(missing_hours between 1 and 72));
insert into public.settings(id) values(true);
create table public.seats(id int primary key check(id>0),row int not null check(row>0),col int not null check(col>0),enabled boolean not null default true,unique(row,col));
insert into public.seats select n,((n-1)/8)+1,((n-1)%8)+1,true from generate_series(1,72)n;
create table public.students(id uuid primary key default extensions.gen_random_uuid(),name text not null check(length(name) between 1 and 80),number text not null unique check(length(number) between 1 and 40),active boolean not null default true,seat_id int unique references public.seats(id));
create table public.student_codes(student_id uuid primary key references public.students(id),code_hash text not null unique,version int not null default 1);
create table public.student_sessions(token_hash text primary key,student_id uuid not null references public.students(id),version int not null,expires_at timestamptz not null);
create index student_sessions_student on public.student_sessions(student_id);
create table public.login_limits(key text primary key,window_start timestamptz not null,hits int not null);
create table public.qr_tokens(token_hash text primary key,expires_at timestamptz not null,created_by uuid not null references public.admins(user_id));
create table public.visits(id uuid primary key default extensions.gen_random_uuid(),student_id uuid not null references public.students(id),entered_at timestamptz not null default now(),exited_at timestamptz,check(exited_at is null or exited_at>=entered_at));
create unique index one_open_visit on public.visits(student_id) where exited_at is null;
create index visits_student_time on public.visits(student_id,entered_at);
create index visits_time on public.visits(entered_at);
create table public.requests(actor text not null,request_id uuid not null,result jsonb not null,primary key(actor,request_id));
create table public.notices(id uuid primary key default extensions.gen_random_uuid(),title text not null check(length(title) between 1 and 160),body text not null check(length(body) between 1 and 10000),important boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.suggestions(id uuid primary key default extensions.gen_random_uuid(),student_id uuid not null references public.students(id),title text not null check(length(title) between 1 and 160),body text not null check(length(body) between 1 and 10000),reply text not null default '' check(length(reply)<=10000),status text not null default '접수' check(status in ('접수','확인 중','처리 완료')),created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create index suggestions_student on public.suggestions(student_id);
create table public.operating_days(day date primary key,start_time time not null,end_time time not null,student_ids uuid[] not null,check(end_time>start_time));
create table public.audits(id bigint generated always as identity primary key,actor uuid not null references public.admins(user_id),kind text not null,before_value jsonb,after_value jsonb,reason text not null check(length(reason)>0),created_at timestamptz not null default now());
create table public.seat_history(id bigint generated always as identity primary key,actor uuid not null references public.admins(user_id),assignments jsonb not null,created_at timestamptz not null default now());
-- All client access goes through the authenticated, scoped Edge API. No direct client table access.
do $$ declare t text; begin foreach t in array array['admins','settings','seats','students','student_codes','student_sessions','login_limits','qr_tokens','visits','requests','notices','suggestions','operating_days','audits','seat_history'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon, authenticated',t);execute format('create policy deny_client on public.%I as restrictive for all to anon, authenticated using (false) with check (false)',t);end loop;end $$;
revoke all on all sequences in schema public from anon,authenticated;

create or replace function public.consume_login_limit(p_key text) returns boolean language plpgsql security definer set search_path=public as $$
declare n int; begin
 insert into login_limits values(p_key,now(),1) on conflict(key) do update set hits=case when login_limits.window_start<now()-interval '10 minutes' then 1 else login_limits.hits+1 end,window_start=case when login_limits.window_start<now()-interval '10 minutes' then now() else login_limits.window_start end returning hits into n;
 return n<=case when p_key like 'ip:%' then 300 else 10 end;
end $$;

create or replace function public.app_api(p_action text,p_payload jsonb default '{}',p_admin uuid default null,p_session text default null) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare sid uuid; s students; v visits; is_admin boolean:=false; result jsonb; old jsonb; item jsonb; v_request_id uuid; v_actor text; x uuid; token text; expiry timestamptz; cfg settings; target uuid;
begin
 if p_action='login' then
  select st.* into s from students st join student_codes c on c.student_id=st.id where c.code_hash=p_payload->>'code_hash' and st.active for update of st;
  if s.id is null then raise exception '코드를 확인하세요.';end if;
  insert into student_sessions select p_payload->>'token_hash',s.id,version,now()+interval '8 hours' from student_codes where student_id=s.id;
  return jsonb_build_object('student_id',s.id,'expires_at',now()+interval '8 hours');
 end if;
 if p_admin is not null then select exists(select 1 from admins where user_id=p_admin) into is_admin;if not is_admin then raise exception '관리자 권한이 없습니다.';end if;v_actor:='admin:'||p_admin;
 else
  select st.* into s from students st join student_sessions ss on ss.student_id=st.id join student_codes c on c.student_id=st.id where ss.token_hash=p_session and ss.expires_at>now() and ss.version=c.version and st.active for update of st;
  if s.id is null then raise exception '세션이 만료되었거나 이용이 중지되었습니다.';end if;sid:=s.id;v_actor:='student:'||sid;
 end if;
 if p_action='logout' then delete from student_sessions where token_hash=p_session;return '{}'::jsonb;end if;
 if p_action='snapshot' then
  select * into cfg from settings;
  return jsonb_build_object('students',coalesce((select jsonb_agg(to_jsonb(st)) from students st where is_admin or st.id=sid),'[]'::jsonb),'seats',coalesce((select jsonb_agg(to_jsonb(se) order by se.id) from seats se),'[]'::jsonb),'visits',coalesce((select jsonb_agg(to_jsonb(vi) order by vi.entered_at desc) from visits vi where is_admin or vi.student_id=sid),'[]'::jsonb),'notices',coalesce((select jsonb_agg(to_jsonb(no) order by no.important desc,no.created_at desc) from notices no),'[]'::jsonb),'suggestions',coalesce((select jsonb_agg(to_jsonb(su) order by su.created_at desc) from suggestions su where is_admin or su.student_id=sid),'[]'::jsonb),'settings',to_jsonb(cfg)-'id','operating_days',coalesce((select jsonb_agg(case when is_admin then to_jsonb(od) else jsonb_build_object('day',od.day,'start_time',od.start_time,'end_time',od.end_time,'student_ids',case when sid=any(od.student_ids) then jsonb_build_array(sid) else '[]'::jsonb end) end) from operating_days od),'[]'::jsonb),'current',(select count(*) from visits where exited_at is null),'today',(select count(distinct student_id) from visits where entered_at>=(date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')),'server_now',now(),'audits',case when is_admin then coalesce((select jsonb_agg(to_jsonb(a)) from (select * from audits order by id desc limit 100)a),'[]'::jsonb) else '[]'::jsonb end);
 end if;
 if p_action='suggest' and not is_admin then insert into suggestions(student_id,title,body) values(sid,p_payload->>'title',p_payload->>'body');return '{}'::jsonb;end if;
 if p_action='attendance' or (p_action='manual' and is_admin) then
  target:=case when is_admin then (p_payload->>'student_id')::uuid else sid end;
  perform pg_advisory_xact_lock(hashtextextended(v_actor||coalesce(p_payload->>'request_id',''),0));
  select * into s from students where id=target for update;if s.id is null or (not s.active and (not is_admin or p_payload->>'direction'<>'out')) then raise exception '이용 가능한 학생이 아닙니다.';end if;
  v_request_id:=(p_payload->>'request_id')::uuid;if v_request_id is null then raise exception '요청 ID가 필요합니다.';end if;
  select r.result into result from requests r where r.actor=v_actor and r.request_id=v_request_id;if result is not null then return result;end if;
  if not is_admin then if not exists(select 1 from qr_tokens where token_hash=p_payload->>'qr_hash' and expires_at>clock_timestamp()) then raise exception 'QR이 만료되었거나 유효하지 않습니다.';end if;
  elsif coalesce(length(trim(p_payload->>'reason')),0)=0 then raise exception '수동 처리 사유가 필요합니다.';end if;
  select * into v from visits where student_id=target and exited_at is null;
  old:=case when v.id is null then null else to_jsonb(v) end;
  if p_payload->>'direction'='in' then if v.id is not null then raise exception '이미 입실 중입니다.';end if;insert into visits(student_id) values(target) returning * into v;
  elsif p_payload->>'direction'='out' then if v.id is null then raise exception '입실 기록이 없습니다.';end if;update visits set exited_at=now() where id=v.id returning * into v;
  else raise exception '입퇴실 구분을 확인하세요.';end if;
  result:=to_jsonb(v);insert into requests values(v_actor,v_request_id,result);
  if is_admin then insert into audits(actor,kind,before_value,after_value,reason) values(p_admin,'manual',old,result,p_payload->>'reason');end if;return result;
 end if;
 if not is_admin then raise exception '관리자 권한이 필요합니다.';end if;
 if p_action='qr' then
  delete from qr_tokens where expires_at<now();insert into qr_tokens values(p_payload->>'token_hash',now()+interval '45 seconds',p_admin) returning expires_at into expiry;return jsonb_build_object('expires_at',expiry);
 elsif p_action='student' then
  perform pg_advisory_xact_lock(72172);
  if p_payload->>'id' is null then if (select count(*) from students where active)>=(select capacity from settings) then raise exception '정원이 가득 찼습니다.';end if;insert into students(name,number) values(p_payload->>'name',p_payload->>'number') returning id into x;
  else x:=(p_payload->>'id')::uuid;select to_jsonb(st) into old from students st where id=x for update;if old is null then raise exception '학생을 찾을 수 없습니다.';end if;
   if (p_payload->>'active')::boolean and not (old->>'active')::boolean and (select count(*) from students where active)>=(select capacity from settings) then raise exception '정원이 가득 찼습니다.';end if;
   update students set name=p_payload->>'name',number=p_payload->>'number',active=(p_payload->>'active')::boolean where id=x;
   if not (p_payload->>'active')::boolean then delete from student_sessions where student_id=x;update student_codes set version=version+1 where student_id=x;end if;
  end if;return jsonb_build_object('id',x);
 elsif p_action='code' then
  x:=(p_payload->>'student_id')::uuid;perform 1 from students where id=x and active for update;if not found then raise exception '이용 가능한 학생이 아닙니다.';end if;
  insert into student_codes values(x,p_payload->>'code_hash',1) on conflict(student_id) do update set code_hash=excluded.code_hash,version=student_codes.version+1;delete from student_sessions where student_id=x;return '{}'::jsonb;
 elsif p_action='settings' then
  perform pg_advisory_xact_lock(72172);if (p_payload->>'capacity')::int<(select count(*) from students where active) then raise exception '정원이 활동 학생 수보다 작습니다.';end if;
  update settings set capacity=(p_payload->>'capacity')::int,exam_date=nullif(p_payload->>'exam_date','')::date,missing_hours=(p_payload->>'missing_hours')::int;return '{}'::jsonb;
 elsif p_action='operating_day' then
  insert into operating_days values((p_payload->>'day')::date,(p_payload->>'start_time')::time,(p_payload->>'end_time')::time,array(select jsonb_array_elements_text(p_payload->'student_ids')::uuid)) on conflict(day) do update set start_time=excluded.start_time,end_time=excluded.end_time,student_ids=excluded.student_ids;return '{}'::jsonb;
 elsif p_action='seat' then
  perform pg_advisory_xact_lock(72172);if not (p_payload->>'enabled')::boolean and exists(select 1 from students where seat_id=(p_payload->>'id')::int) then raise exception '배정된 좌석은 먼저 배정을 해제하세요.';end if;
  insert into seats values((p_payload->>'id')::int,(p_payload->>'row')::int,(p_payload->>'col')::int,(p_payload->>'enabled')::boolean) on conflict(id) do update set row=excluded.row,col=excluded.col,enabled=excluded.enabled;return '{}'::jsonb;
 elsif p_action='assign' then
  perform pg_advisory_xact_lock(72172);perform 1 from students order by id for update;perform 1 from seats order by id for update;
  if jsonb_typeof(p_payload->'pairs')<>'array' then raise exception '배정 목록이 필요합니다.';end if;
  if (select count(*)<>count(distinct z->>'student_id') from jsonb_array_elements(p_payload->'pairs')z) then raise exception '학생이 중복되었습니다.';end if;
  select jsonb_agg(to_jsonb(st)) into old from students st;
  for item in select * from jsonb_array_elements(p_payload->'pairs') loop
   if not exists(select 1 from students where id=(item->>'student_id')::uuid) then raise exception '학생을 찾을 수 없습니다.';end if;
   if item->>'seat_id' is not null and not exists(select 1 from seats where id=(item->>'seat_id')::int and enabled) then raise exception '사용 불가능한 좌석입니다.';end if;
   update students set seat_id=null where id=(item->>'student_id')::uuid;
  end loop;
  for item in select * from jsonb_array_elements(p_payload->'pairs') loop update students set seat_id=(item->>'seat_id')::int where id=(item->>'student_id')::uuid;end loop;
  insert into seat_history(actor,assignments) values(p_admin,p_payload->'pairs');insert into audits(actor,kind,before_value,after_value,reason) values(p_admin,'assign',old,p_payload->'pairs','좌석 배정 확정');return '{}'::jsonb;
 elsif p_action='notice_delete' then delete from notices where id=(p_payload->>'id')::uuid;return '{}'::jsonb;
 elsif p_action='notice' then
  if p_payload->>'id' is null then insert into notices(title,body,important) values(p_payload->>'title',p_payload->>'body',coalesce((p_payload->>'important')::boolean,false));
  else update notices set title=p_payload->>'title',body=p_payload->>'body',important=(p_payload->>'important')::boolean,updated_at=now() where id=(p_payload->>'id')::uuid;end if;return '{}'::jsonb;
 elsif p_action='reply' then update suggestions set reply=p_payload->>'reply',status=p_payload->>'status',updated_at=now() where id=(p_payload->>'id')::uuid;return '{}'::jsonb;
 elsif p_action='correct' then
  if coalesce(length(trim(p_payload->>'reason')),0)=0 then raise exception '수정 사유가 필요합니다.';end if;
  select * into v from visits where id=(p_payload->>'id')::uuid;if v.id is null then raise exception '기록이 없습니다.';end if;perform 1 from students where id=v.student_id for update;
  select to_jsonb(vi) into old from visits vi where id=v.id for update;
  update visits set entered_at=(p_payload->>'entered_at')::timestamptz,exited_at=nullif(p_payload->>'exited_at','')::timestamptz where id=v.id returning to_jsonb(visits.*) into result;
  insert into audits(actor,kind,before_value,after_value,reason) values(p_admin,'correct',old,result,p_payload->>'reason');return result;
 end if;
 raise exception '지원하지 않는 요청입니다.';
end $$;
revoke all on function public.app_api(text,jsonb,uuid,text) from public,anon,authenticated;
revoke all on function public.consume_login_limit(text) from public,anon,authenticated;
grant execute on function public.app_api(text,jsonb,uuid,text) to service_role;
grant execute on function public.consume_login_limit(text) to service_role;
