create function public.new_login_code() returns text language plpgsql set search_path='' as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; bytes bytea; result text; i int;
begin
 loop
  bytes:=extensions.gen_random_bytes(5);result:='';
  for i in 0..4 loop result:=result||substr(alphabet,(get_byte(bytes,i)%32)+1,1);end loop;
  if result ~ '[A-Z]' and result ~ '[2-9]' then return result;end if;
 end loop;
end $$;

create function public.issue_student_code(p_admin uuid,p_student uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare new_code text; digest text; attempt int;
begin
 if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then raise exception '관리자 권한이 필요합니다.';end if;
 perform pg_advisory_xact_lock(72175);
 for attempt in 1..100 loop
  new_code:=public.new_login_code();digest:=public.code_digest(new_code);
  if not exists(select 1 from public.student_codes where code_hash=digest) and not exists(select 1 from public.teacher_viewer_code where code_hash=digest) then
   perform public.app_api('code',jsonb_build_object('student_id',p_student,'code_hash',digest),p_admin,null);
   return jsonb_build_object('code',new_code);
  end if;
 end loop;
 raise exception '코드 발급을 다시 시도하세요.';
end $$;

create or replace function public.teacher_access(p_admin uuid,p_rotate boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare secret_id uuid; code_value text; digest text; attempt int;
begin
 if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then raise exception '관리자 권한이 필요합니다.'; end if;
 perform pg_advisory_xact_lock(72174);
 perform pg_advisory_xact_lock(72175);
 select id,decrypted_secret into secret_id,code_value from vault.decrypted_secrets where name='study_hall_teacher_viewer_code';
 if secret_id is null or p_rotate or length(code_value)<>5 then
  for attempt in 1..100 loop
   code_value:=public.new_login_code();digest:=public.code_digest(code_value);
   exit when not exists(select 1 from public.student_codes where code_hash=digest) and not exists(select 1 from public.teacher_viewer_code where code_hash=digest);
   if attempt=100 then raise exception '코드 발급을 다시 시도하세요.';end if;
  end loop;
  if secret_id is null then perform vault.create_secret(code_value,'study_hall_teacher_viewer_code','Read-only teacher access code');
  else perform vault.update_secret(secret_id,code_value);end if;
  insert into public.teacher_viewer_code(id,code_hash) values(true,digest)
   on conflict(id) do update set code_hash=excluded.code_hash,version=public.teacher_viewer_code.version+1;
  delete from public.teacher_viewer_sessions;
  insert into public.audits(actor,kind,reason) values(p_admin,'teacher_code','교사 조회 전용 코드 발급');
 end if;
 return jsonb_build_object('code',code_value,'role','viewer');
end $$;
revoke all on function public.new_login_code(),public.issue_student_code(uuid,uuid) from public,anon,authenticated;
grant execute on function public.new_login_code(),public.issue_student_code(uuid,uuid) to service_role;
-- teacher_access keeps its existing service-only grants.
