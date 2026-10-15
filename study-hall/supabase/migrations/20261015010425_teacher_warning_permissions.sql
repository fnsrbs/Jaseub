-- Teacher codes are shared: record teacher role without inventing individual identity.
alter table public.warning_cards alter column actor drop not null;
alter table public.warning_cards add column actor_role text not null default 'admin' check(actor_role in ('admin','teacher'));
create table public.teacher_warning_events (
 id bigint generated always as identity primary key,
 card_id uuid not null references public.warning_cards(id),
 action text not null check(action in ('warning_issue','warning_delete')),
 reason text not null,
 before_value jsonb,
 created_at timestamptz not null default now(),
 unique(card_id,action)
);
alter table public.teacher_warning_events enable row level security;
revoke all on public.teacher_warning_events from public,anon,authenticated;
create policy deny_client on public.teacher_warning_events as restrictive for all to anon,authenticated using(false) with check(false);
create function public.teacher_warning_api(p_action text,p_payload jsonb,p_session text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg public.teacher_viewer_code; card public.warning_cards; target uuid; request uuid; reason text := trim(p_payload->>'reason');
begin
 select * into cfg from public.teacher_viewer_code where id=true for share;
 perform 1 from public.teacher_viewer_sessions where token_hash=p_session and version=cfg.version and expires_at>now() for share;
 if not found then raise exception '교사 세션이 만료되었습니다.'; end if;
 if p_action not in ('warning_issue','warning_delete') or p_action is null then raise exception '경고카드 관리만 가능합니다.'; end if;
 if reason is null or length(reason) not between 1 and 1000 then raise exception '사유(1~1000자)를 입력하세요.'; end if;
 if p_action='warning_issue' then
  target := (p_payload->>'student_id')::uuid; request := (p_payload->>'request_id')::uuid;
  if request is null then raise exception '요청 번호가 필요합니다.'; end if;
  perform 1 from public.students where id=target and deleted_at is null for update;
  if not found then raise exception '학생을 찾을 수 없습니다.'; end if;
  insert into public.warning_cards(id,student_id,actor,actor_role,reason) values(request,target,null,'teacher',reason) on conflict(id) do nothing returning * into card;
  if card.id is null then
   select * into card from public.warning_cards where id=request;
   if card.student_id is distinct from target or card.reason is distinct from reason or card.actor_role<>'teacher' then raise exception '이미 사용한 요청 번호입니다.'; end if;
  else
   insert into public.teacher_warning_events(card_id,action,reason) values(card.id,p_action,reason);
  end if;
  return to_jsonb(card)-'actor';
 else
  select * into card from public.warning_cards where id=(p_payload->>'id')::uuid for update;
  if card.id is null then raise exception '경고카드를 찾을 수 없습니다.'; end if;
  if card.deleted_at is not null then return '{}'::jsonb; end if;
  update public.warning_cards set deleted_at=now() where id=card.id;
  insert into public.teacher_warning_events(card_id,action,reason,before_value) values(card.id,p_action,reason,to_jsonb(card));
  return '{}'::jsonb;
 end if;
end $$;
revoke all on function public.teacher_warning_api(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.teacher_warning_api(text,jsonb,text) to service_role;
