-- Append-only warning cards. All access is through verified, service-only RPCs.
create table public.warning_cards (
 id uuid primary key,
 student_id uuid not null references public.students(id),
 actor uuid not null references public.admins(user_id),
 reason text not null check(length(trim(reason)) between 1 and 1000),
 created_at timestamptz not null default now()
);
create index warning_cards_student_created on public.warning_cards(student_id,created_at desc);
create index warning_cards_actor on public.warning_cards(actor);
alter table public.warning_cards enable row level security;
revoke all on public.warning_cards from public,anon,authenticated;
create policy deny_client on public.warning_cards as restrictive for all to anon,authenticated using(false) with check(false);

create function public.issue_warning(p_admin uuid,p_student uuid,p_reason text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare card public.warning_cards;
begin
 if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then raise exception '관리자 권한이 필요합니다.'; end if;
 if p_request is null or p_reason is null or length(trim(p_reason)) not between 1 and 1000 then raise exception '경고 사유(1~1000자)를 입력하세요.'; end if;
 perform 1 from public.students where id=p_student and deleted_at is null for update;
 if not found then raise exception '학생을 찾을 수 없습니다.'; end if;
 insert into public.warning_cards(id,student_id,actor,reason) values(p_request,p_student,p_admin,trim(p_reason)) on conflict(id) do nothing returning * into card;
 if card.id is null then
  select * into card from public.warning_cards where id=p_request;
  if card.student_id is distinct from p_student or card.actor is distinct from p_admin or card.reason is distinct from trim(p_reason) then raise exception '이미 사용한 요청 번호입니다.'; end if;
 else
  insert into public.audits(actor,kind,after_value,reason) values(p_admin,'warning_issue',to_jsonb(card),card.reason);
 end if;
 return to_jsonb(card)-'actor';
end $$;

-- Existing snapshot RPCs validate admin membership/session expiry/version and scope.
-- Join to that scoped roster so students can only see their own warning cards.
create function public.snapshot_with_warnings(p_admin uuid default null,p_session text default null,p_viewer_session text default null) returns jsonb
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
  from public.warning_cards w where w.student_id in (
   select (s->>'id')::uuid from jsonb_array_elements(result->'students') s
  )
 ),'[]'::jsonb));
end $$;

-- Assignment and same-gender validation share the transaction and original row locks.
-- If a preview was changed or genders/seats changed meanwhile, all writes roll back.
create function public.assign_seats(p_admin uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then raise exception '관리자 권한이 필요합니다.'; end if;
 result := public.app_api('assign',p_payload,p_admin,null);
 if coalesce((p_payload->>'same_gender_pairs')::boolean,false) and exists (
  select 1 from public.students a join public.seats sa on sa.id=a.seat_id
  join public.seats sb on sb.row=sa.row and (sb.col-1)/3=(sa.col-1)/3 and sb.id<>sa.id
  join public.students b on b.seat_id=sb.id
  where (a.id in (select (z->>'student_id')::uuid from jsonb_array_elements(p_payload->'pairs') z)
     or b.id in (select (z->>'student_id')::uuid from jsonb_array_elements(p_payload->'pairs') z))
    and (a.gender='unknown' or b.gender='unknown' or a.gender<>b.gender)
 ) then raise exception '같은 성별끼리 짝이 되도록 좌석을 선택하세요. 미확인 성별과 고정 좌석도 확인하세요.';
 end if;
 return result;
end $$;
revoke all on function public.issue_warning(uuid,uuid,text,uuid),public.snapshot_with_warnings(uuid,text,text),public.assign_seats(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.issue_warning(uuid,uuid,text,uuid),public.snapshot_with_warnings(uuid,text,text),public.assign_seats(uuid,jsonb) to service_role;
