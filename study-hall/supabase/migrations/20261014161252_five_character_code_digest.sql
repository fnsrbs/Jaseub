create or replace function public.code_digest(p_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare secret_value text; normalized text := pg_catalog.upper(pg_catalog.btrim(p_code));
begin
 if normalized is null or normalized !~ '^([A-Z0-9]{5}|[A-Z0-9-]{16,80})$' then raise exception '코드 형식을 확인하세요.';end if;
 select s.decrypted_secret into secret_value from vault.decrypted_secrets s where s.name='study_hall_code_pepper';
 if secret_value is null then raise exception '서버 인증 설정이 필요합니다.';end if;
 return pg_catalog.encode(extensions.hmac(pg_catalog.convert_to(normalized,'UTF8'),pg_catalog.convert_to(secret_value,'UTF8'),'sha256'),'hex');
end $$;
revoke all on function public.code_digest(text) from public,anon,authenticated;
grant execute on function public.code_digest(text) to service_role;
