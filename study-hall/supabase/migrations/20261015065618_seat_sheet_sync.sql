create table public.seat_sheet_sync_config (
 id boolean primary key default true check(id),
 secret_id uuid,
 spreadsheet_id text not null,
 target_sheet_id integer not null,
 endpoint text not null default '',
 last_synced_at timestamptz,
 last_synced_by uuid references public.admins(user_id)
);
alter table public.seat_sheet_sync_config enable row level security;
revoke all on public.seat_sheet_sync_config from public,anon,authenticated;
create policy deny_client on public.seat_sheet_sync_config as restrictive for all to anon,authenticated using(false) with check(false);
create function public.seat_sheet_sync(p_admin uuid,p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg public.seat_sheet_sync_config; sid uuid; secret_value text; endpoint_value text;
begin
 if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then raise exception '관리자 권한이 필요합니다.'; end if;
 if p_action is null or p_action not in ('status','prepare','credentials','payload','configure','record') then raise exception '지원하지 않는 요청입니다.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(72179);
 select * into cfg from public.seat_sheet_sync_config where id=true for update;
 if p_action='prepare' and cfg.id is null then raise exception '구글 시트 대상 설정이 필요합니다.'; end if;
 if p_action='prepare' and cfg.secret_id is null then
  select id into sid from vault.decrypted_secrets where name='study_hall_seat_sheet_sync';
  if sid is null then sid:=vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'study_hall_seat_sheet_sync','Signed school seat-map updates'); end if;
  update public.seat_sheet_sync_config set secret_id=sid where id=true returning * into cfg;
  insert into public.audits(actor,kind,reason) values(p_admin,'sheet_sync_setup','구글 좌석표 연결 준비');
 end if;
 if p_action='status' then return jsonb_build_object('configured',coalesce(cfg.endpoint,'')<>'','endpoint',coalesce(cfg.endpoint,''),'last_synced_at',cfg.last_synced_at); end if;
 if cfg.id is null then raise exception '구글 시트 연결 설정을 먼저 진행하세요.'; end if;
 if p_action in ('prepare','credentials','payload') then
  select decrypted_secret into secret_value from vault.decrypted_secrets where id=cfg.secret_id;
  if secret_value is null then raise exception '구글 연결 인증값을 확인하세요.'; end if;
  if p_action='payload' then
   if cfg.endpoint='' then raise exception '구글 시트 연결 설정이 필요합니다.'; end if;
   return jsonb_build_object('endpoint',cfg.endpoint,'secret',secret_value,'spreadsheet_id',cfg.spreadsheet_id,'target_sheet_id',cfg.target_sheet_id,
    'seats',coalesce((select jsonb_agg(jsonb_build_object('id',id,'row',row,'col',col,'enabled',enabled) order by id) from public.seats),'[]'::jsonb),
    'students',coalesce((select jsonb_agg(jsonb_build_object('id',id,'number',number,'name',name,'seat_id',seat_id)) from public.students where deleted_at is null),'[]'::jsonb));
  end if;
  return jsonb_build_object('endpoint',cfg.endpoint,'secret',secret_value,'spreadsheet_id',cfg.spreadsheet_id,'target_sheet_id',cfg.target_sheet_id);
 end if;
 if p_action='configure' then
  endpoint_value:=trim(p_payload->>'endpoint');
  if endpoint_value is null or endpoint_value !~ '^https://script[.]google[.]com/macros/s/[A-Za-z0-9_-]+/exec$' then raise exception '올바른 Apps Script 웹앱 배포 주소를 입력하세요.'; end if;
  update public.seat_sheet_sync_config set endpoint=endpoint_value where id=true;
  insert into public.audits(actor,kind,before_value,after_value,reason) values(p_admin,'sheet_sync_config',jsonb_build_object('endpoint',cfg.endpoint),jsonb_build_object('endpoint',endpoint_value),'구글 좌석표 연결');
  return jsonb_build_object('configured',true,'endpoint',endpoint_value,'last_synced_at',cfg.last_synced_at);
 end if;
 if p_action='record' then
  if cfg.endpoint='' or (p_payload->>'updated')::integer is distinct from 72 then raise exception '반영 결과를 확인하세요.'; end if;
  update public.seat_sheet_sync_config set last_synced_at=now(),last_synced_by=p_admin where id=true;
  insert into public.audits(actor,kind,before_value,after_value,reason) values(p_admin,'sheet_seat_sync',p_payload->'before',p_payload-'before','확정 좌석 구글 시트 반영');
  return jsonb_build_object('updated',72,'last_synced_at',now());
 end if;
end $$;
revoke all on function public.seat_sheet_sync(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.seat_sheet_sync(uuid,text,jsonb) to service_role;
