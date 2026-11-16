-- Existing admin-only endpoint, now accepting scoped patches so login text and
-- farewell edits cannot overwrite one another. Existing callers remain valid.
create or replace function public.set_site_copy(p_admin uuid, p_copy jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  k text;
  old_copy jsonb;
  next_copy jsonb;
begin
  if p_admin is null or not exists(select 1 from public.admins where user_id = p_admin) then
    raise exception '관리자 권한이 필요합니다.';
  end if;
  if jsonb_typeof(p_copy) is distinct from 'object' then
    raise exception '문구 형식을 확인하세요.';
  end if;
  if p_copy = '{}'::jsonb or exists(
    select 1 from jsonb_object_keys(p_copy) x(key)
    where x.key not in (
      'hero_eyebrow', 'hero_title', 'hero_description', 'login_title',
      'login_greeting', 'production_badge', 'ranking_encouragement',
      'farewell_enabled', 'farewell_date', 'farewell_eyebrow', 'farewell_title',
      'farewell_body', 'farewell_wish', 'farewell_medal_label',
      'farewell_medal_title', 'farewell_medal_body', 'farewell_signature'
    )
  ) then
    raise exception '문구 항목을 확인하세요.';
  end if;
  for k in select jsonb_object_keys(p_copy) loop
    if jsonb_typeof(p_copy->k) is distinct from 'string' or length(p_copy->>k) > 2000 then
      raise exception '문구는 2000자 이내의 글자로 입력하세요.';
    end if;
  end loop;
  if p_copy ? 'farewell_enabled' and p_copy->>'farewell_enabled' not in ('true', 'false') then
    raise exception '편지 표시 여부를 확인하세요.';
  end if;
  if p_copy ? 'farewell_date' then
    if p_copy->>'farewell_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception '표시 날짜를 확인하세요.';
    end if;
    begin
      if to_char((p_copy->>'farewell_date')::date, 'YYYY-MM-DD') <> p_copy->>'farewell_date' then
        raise exception '표시 날짜를 확인하세요.';
      end if;
    exception when datetime_field_overflow or invalid_datetime_format then
      raise exception '표시 날짜를 확인하세요.';
    end;
  end if;
  foreach k in array array['farewell_title', 'farewell_medal_title'] loop
    if p_copy ? k and length(btrim(p_copy->>k)) = 0 then
      raise exception '편지 제목과 훈장 이름을 입력하세요.';
    end if;
  end loop;
  select site_copy into old_copy from public.settings where id = true for update;
  next_copy := old_copy || p_copy;
  update public.settings set site_copy = next_copy where id = true;
  insert into public.audits(actor, kind, before_value, after_value, reason)
    values(p_admin, 'site_copy', old_copy, next_copy, '화면 문구·응원 편지 변경');
  return next_copy;
end;
$function$;

revoke all on function public.set_site_copy(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_site_copy(uuid, jsonb) to service_role;
