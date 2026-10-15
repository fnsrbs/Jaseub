create table public.role_menu_order (
 id boolean primary key default true check(id),
 orders jsonb not null default '{}',
 revision int not null default 1 check(revision>0)
);
insert into public.role_menu_order(id) values(true);
alter table public.role_menu_order enable row level security;
revoke all on public.role_menu_order from public,anon,authenticated;
create policy deny_client on public.role_menu_order as restrictive for all to anon,authenticated using(false) with check(false);
create function public.menu_order_api(p_action text,p_payload jsonb default '{}',p_admin uuid default null,p_viewer_session text default null,p_student_session text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old public.role_menu_order; saved public.role_menu_order; role_key text; allowed text[]; orders jsonb:=p_payload->'orders';
begin
 perform public.cleaning_api('read','{}',p_admin,p_viewer_session,p_student_session);
 if p_action='read' then return (select jsonb_build_object('orders',r.orders,'revision',r.revision) from public.role_menu_order r where id=true);end if;
 if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then raise exception '메뉴 순서 수정은 관리자만 가능합니다.';end if;
 if p_action<>'save' then raise exception '지원하지 않는 요청입니다.';end if;
 if jsonb_typeof(orders) is distinct from 'object' or (select count(*) from jsonb_object_keys(orders))<>3 then raise exception '역할별 메뉴 구성을 확인하세요.';end if;
 foreach role_key in array array['student','viewer','teacher'] loop
  allowed:=case role_key
   when 'student' then array['home','ranking','cleaning','seats','warnings','records','notices','suggestions','stats']
   when 'viewer' then array['home','ranking','supervision','cleaning','student-lookup','seats','warnings','records','notices','suggestions','stats']
   else array['home','ranking','supervision','cleaning','students','seats','warnings','records','qr','notices','suggestions','stats','settings'] end;
  if jsonb_typeof(orders->role_key) is distinct from 'array' or jsonb_array_length(orders->role_key)<>cardinality(allowed) then raise exception '메뉴를 빠짐없이 지정하세요.';end if;
  if exists(select 1 from jsonb_array_elements(orders->role_key) v where jsonb_typeof(v)<>'string' or not ((v#>>'{}')=any(allowed))) or (select count(distinct v) from jsonb_array_elements(orders->role_key) v)<>cardinality(allowed) then raise exception '허용되지 않거나 중복된 메뉴입니다.';end if;
 end loop;
 select * into old from public.role_menu_order where id=true for update;
 if old.revision is distinct from (p_payload->>'revision')::int then raise exception '다른 변경이 있습니다. 변경 취소 후 다시 수정하세요.';end if;
 update public.role_menu_order set orders=p_payload->'orders',revision=revision+1 where id=true returning * into saved;
 insert into public.audits(actor,kind,before_value,after_value,reason) values(p_admin,'menu_order',to_jsonb(old),to_jsonb(saved),'역할별 메뉴 순서 수정');
 return jsonb_build_object('orders',saved.orders,'revision',saved.revision);
end $$;
revoke all on function public.menu_order_api(text,jsonb,uuid,text,text) from public,anon,authenticated;
grant execute on function public.menu_order_api(text,jsonb,uuid,text,text) to service_role;
