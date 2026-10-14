-- Generate the login pepper inside Supabase; never return it to a client or commit it.
create extension if not exists supabase_vault with schema vault;
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'study_hall_code_pepper') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'study_hall_code_pepper',
      'Server-only student code HMAC key'
    );
  end if;
end $$;

create or replace function public.code_digest(p_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare secret_value text;
begin
  if length(p_code) not between 16 and 80 then
    raise exception '코드 형식을 확인하세요.';
  end if;
  select s.decrypted_secret into secret_value
    from vault.decrypted_secrets s where s.name = 'study_hall_code_pepper';
  if secret_value is null then raise exception '서버 인증 설정이 필요합니다.'; end if;
  return pg_catalog.encode(extensions.hmac(
    pg_catalog.convert_to(pg_catalog.upper(pg_catalog.btrim(p_code)), 'UTF8'),
    pg_catalog.convert_to(secret_value, 'UTF8'),
    'sha256'
  ), 'hex');
end $$;
revoke all on function public.code_digest(text) from public, anon, authenticated;
grant execute on function public.code_digest(text) to service_role;
revoke all on vault.secrets, vault.decrypted_secrets from anon, authenticated;
