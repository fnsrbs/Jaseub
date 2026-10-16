create table public.staff_manual_attendance_events (
 id bigint generated always as identity primary key,
 actor text not null,
 actor_role text not null check(actor_role in ('admin','teacher')),
 request_id uuid not null,
 student_id uuid not null references public.students(id),
 direction text not null check(direction in ('in','out')),
 reason text not null check(length(reason) between 1 and 500),
 before_value jsonb,
 after_value jsonb not null,
 created_at timestamptz not null default now(),
 unique(actor,request_id)
);
alter table public.staff_manual_attendance_events enable row level security;
revoke all on public.staff_manual_attendance_events from public,anon,authenticated;
revoke all on sequence public.staff_manual_attendance_events_id_seq from public,anon,authenticated;
create policy deny_client on public.staff_manual_attendance_events as restrictive for all to anon,authenticated using(false) with check(false);

create function public.staff_manual_attendance(p_payload jsonb,p_admin uuid default null,p_viewer_session text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 is_admin boolean:=exists(select 1 from public.admins where user_id=p_admin);
 cfg public.teacher_viewer_code; actor_name text; target uuid:=(p_payload->>'student_id')::uuid;
 request uuid:=(p_payload->>'request_id')::uuid; direction text:=p_payload->>'direction'; reason text:=trim(p_payload->>'reason');
 old_event public.staff_manual_attendance_events; student public.students; visit public.visits; previous jsonb; result jsonb;
begin
 if is_admin then actor_name:='admin:'||p_admin;
 else
  select * into cfg from public.teacher_viewer_code where id=true for share;
  perform 1 from public.teacher_viewer_sessions where token_hash=p_viewer_session and version=cfg.version and expires_at>now() for share;
  if not found then raise exception '교사 또는 관리자 권한이 필요합니다.'; end if;
  actor_name:='teacher:'||left(p_viewer_session,12);
 end if;
 if request is null then raise exception '요청 번호가 필요합니다.'; end if;
 if direction is null or direction not in ('in','out') then raise exception '입퇴실 구분을 확인하세요.'; end if;
 if reason is null or length(reason) not between 1 and 500 then raise exception '수동 처리 사유(1~500자)를 입력하세요.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor_name||request::text,0));
 select * into old_event from public.staff_manual_attendance_events where actor=actor_name and request_id=request;
 if found then
  if old_event.student_id is distinct from target or old_event.direction<>direction or old_event.reason<>reason then raise exception '이미 사용한 요청 번호입니다.'; end if;
  return old_event.after_value;
 end if;
 select * into student from public.students where id=target and deleted_at is null for update;
 if not found or (not student.active and direction='in') then raise exception '이용 가능한 학생이 아닙니다.'; end if;
 select * into visit from public.visits where student_id=target and exited_at is null for update;
 previous:=case when visit.id is null then null else to_jsonb(visit) end;
 if direction='in' then
  if visit.id is not null then raise exception '이미 입실 중입니다.'; end if;
  insert into public.visits(student_id) values(target) returning * into visit;
 else
  if visit.id is null then raise exception '입실 기록이 없습니다.'; end if;
  update public.visits set exited_at=now() where id=visit.id returning * into visit;
 end if;
 result:=to_jsonb(visit);
 insert into public.staff_manual_attendance_events(actor,actor_role,request_id,student_id,direction,reason,before_value,after_value)
 values(actor_name,case when is_admin then 'admin' else 'teacher' end,request,target,direction,reason,previous,result);
 if is_admin then insert into public.audits(actor,kind,before_value,after_value,reason) values(p_admin,'manual',previous,result,reason); end if;
 return result;
end $$;
revoke all on function public.staff_manual_attendance(jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.staff_manual_attendance(jsonb,uuid,text) to service_role;
