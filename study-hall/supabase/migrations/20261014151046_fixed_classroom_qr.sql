-- Only teachers may retrieve or replace the permanent classroom QR.
-- The printable token is encrypted in Vault; the validator keeps only its hash.
create or replace function public.classroom_qr(p_admin uuid, p_rotate boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare secret_id uuid; qr_value text; issued_at timestamptz;
begin
  if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then
    raise exception '관리자 권한이 필요합니다.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(72173);
  select id,decrypted_secret,updated_at into secret_id,qr_value,issued_at
    from vault.decrypted_secrets where name='study_hall_classroom_qr';
  if secret_id is null or p_rotate then
    qr_value := 'SH1.' || pg_catalog.encode(extensions.gen_random_bytes(32),'hex');
    if secret_id is null then
      secret_id := vault.create_secret(qr_value,'study_hall_classroom_qr','Printable classroom QR');
    else
      perform vault.update_secret(secret_id,qr_value);
    end if;
    issued_at := pg_catalog.clock_timestamp();
    -- Reissue invalidates the previous poster and any legacy rotating QR.
    update public.qr_tokens set expires_at=pg_catalog.clock_timestamp()
      where expires_at>pg_catalog.clock_timestamp();
  end if;
  insert into public.qr_tokens(token_hash,expires_at,created_by)
    values(pg_catalog.encode(extensions.digest(qr_value,'sha256'),'hex'),'infinity'::timestamptz,p_admin)
    on conflict(token_hash) do update set expires_at='infinity'::timestamptz;
  return pg_catalog.jsonb_build_object('token',qr_value,'fixed',true,'expires_at',null,'issued_at',issued_at);
end $$;
revoke all on function public.classroom_qr(uuid,boolean) from public,anon,authenticated;
grant execute on function public.classroom_qr(uuid,boolean) to service_role;
