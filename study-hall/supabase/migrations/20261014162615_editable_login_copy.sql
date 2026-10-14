alter table public.settings add column site_copy jsonb not null default $copy${"hero_eyebrow":"A SPACE FOR YOUR GROWTH","hero_title":"꾸준한 오늘이\n더 큰 내일을 만듭니다.","hero_description":"입실부터 퇴실까지, 나의 공부 시간을\n차분하게 기록하는 자습실.","login_title":"자습실에 들어가기","login_greeting":"안녕하세요. 오늘의 집중을 시작해 볼까요?","production_badge":"실제 DB 운영 모드"}$copy$::jsonb;
create function public.get_site_copy() returns jsonb language sql security definer set search_path='' as $$ select site_copy from public.settings where id=true $$;
create function public.set_site_copy(p_admin uuid,p_copy jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare k text; old_copy jsonb;
begin
 if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then raise exception '관리자 권한이 필요합니다.';end if;
 if jsonb_typeof(p_copy) is distinct from 'object' then raise exception '문구 형식을 확인하세요.';end if;
 if (select count(*) from jsonb_object_keys(p_copy))<>6 then raise exception '문구 항목을 확인하세요.';end if;
 foreach k in array array['hero_eyebrow','hero_title','hero_description','login_title','login_greeting','production_badge'] loop
  if jsonb_typeof(p_copy->k) is distinct from 'string' or length(p_copy->>k)>2000 then raise exception '문구는 2000자 이내의 글자로 입력하세요.';end if;
 end loop;
 select site_copy into old_copy from public.settings where id=true for update;
 update public.settings set site_copy=p_copy where id=true;
 insert into public.audits(actor,kind,before_value,after_value,reason) values(p_admin,'site_copy',old_copy,p_copy,'로그인 화면 문구 변경');
 return p_copy;
end $$;
revoke all on function public.get_site_copy(),public.set_site_copy(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.get_site_copy(),public.set_site_copy(uuid,jsonb) to service_role;

