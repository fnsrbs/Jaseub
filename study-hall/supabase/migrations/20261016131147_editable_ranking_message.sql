update public.settings set site_copy=site_copy||jsonb_build_object('ranking_encouragement',coalesce(site_copy->>'ranking_encouragement',$message$자신의 속도에 맞춰 꾸준히 공부해 주세요.

조급해하지 않고 나아가다 보면, 어느새 목표에 가까워져 있을 거예요.

꾸준히 나아가는 여러분의 모든 걸음을 응원합니다!$message$)) where id=true;

create or replace function public.set_site_copy(p_admin uuid,p_copy jsonb) returns jsonb language plpgsql security definer set search_path='' as $function$
declare k text; old_copy jsonb; next_copy jsonb;
begin
 if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then raise exception '관리자 권한이 필요합니다.';end if;
 if jsonb_typeof(p_copy) is distinct from 'object' then raise exception '문구 형식을 확인하세요.';end if;
 if (select count(*) from jsonb_object_keys(p_copy)) not between 6 and 7
   or exists(select 1 from jsonb_object_keys(p_copy) x(key) where x.key not in ('hero_eyebrow','hero_title','hero_description','login_title','login_greeting','production_badge','ranking_encouragement')) then raise exception '문구 항목을 확인하세요.';end if;
 foreach k in array array['hero_eyebrow','hero_title','hero_description','login_title','login_greeting','production_badge'] loop
  if jsonb_typeof(p_copy->k) is distinct from 'string' or length(p_copy->>k)>2000 then raise exception '문구는 2000자 이내의 글자로 입력하세요.';end if;
 end loop;
 if p_copy ? 'ranking_encouragement' and (jsonb_typeof(p_copy->'ranking_encouragement') is distinct from 'string' or length(p_copy->>'ranking_encouragement')>2000) then raise exception '응원 문구는 2000자 이내의 글자로 입력하세요.'; end if;
 select site_copy into old_copy from public.settings where id=true for update;
 next_copy:=p_copy||jsonb_build_object('ranking_encouragement',coalesce(p_copy->>'ranking_encouragement',old_copy->>'ranking_encouragement',''));
 update public.settings set site_copy=next_copy where id=true;
 insert into public.audits(actor,kind,before_value,after_value,reason) values(p_admin,'site_copy',old_copy,next_copy,'화면 문구 변경');
 return next_copy;
end $function$;
revoke all on function public.set_site_copy(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.set_site_copy(uuid,jsonb) to service_role;
