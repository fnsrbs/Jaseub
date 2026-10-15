alter table public.warning_cards add column deleted_at timestamptz;
create function public.delete_warning(p_admin uuid,p_card uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare card public.warning_cards;
begin
 if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then raise exception '관리자 권한이 필요합니다.'; end if;
 if p_reason is null or length(trim(p_reason)) not between 1 and 1000 then raise exception '삭제 사유(1~1000자)를 입력하세요.'; end if;
 select * into card from public.warning_cards where id=p_card for update;
 if card.id is null then raise exception '경고카드를 찾을 수 없습니다.'; end if;
 if card.deleted_at is not null then return '{}'::jsonb; end if;
 update public.warning_cards set deleted_at=now() where id=p_card;
 insert into public.audits(actor,kind,before_value,after_value,reason)
 values(p_admin,'warning_delete',to_jsonb(card),jsonb_build_object('id',p_card,'deleted_at',now()),trim(p_reason));
 return '{}'::jsonb;
end $$;
revoke all on function public.delete_warning(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.delete_warning(uuid,uuid,text) to service_role;

create or replace function public.snapshot_with_warnings(p_admin uuid default null,p_session text default null,p_viewer_session text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_viewer_session is not null then
  result := public.teacher_viewer_api('snapshot','{}',p_viewer_session);
 else
  result := public.app_api('snapshot','{}',p_admin,p_session);
 end if;
 return result || jsonb_build_object('warnings',coalesce((
  select jsonb_agg(to_jsonb(w)-'actor' order by w.created_at desc,w.id)
  from public.warning_cards w where w.deleted_at is null and w.student_id in (
   select (s->>'id')::uuid from jsonb_array_elements(result->'students') s
  )
 ),'[]'::jsonb));
end $$;
