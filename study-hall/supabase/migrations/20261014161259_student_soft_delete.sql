alter table public.students add column deleted_at timestamptz;
create function public.delete_student(p_admin uuid,p_student uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare st public.students;
begin
 if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then raise exception '관리자 권한이 필요합니다.';end if;
 perform pg_advisory_xact_lock(72172);
 select * into st from public.students where id=p_student for update;
 if st.id is null then raise exception '학생을 찾을 수 없습니다.';end if;
 if st.deleted_at is not null then return '{}'::jsonb;end if;
 if exists(select 1 from public.visits where student_id=p_student and exited_at is null) then raise exception '입실 중인 학생은 먼저 퇴실 처리하세요.';end if;
 update public.students set active=false,seat_id=null,deleted_at=clock_timestamp() where id=p_student;
 delete from public.student_sessions where student_id=p_student;
 update public.student_codes set version=version+1 where student_id=p_student;
 insert into public.audits(actor,kind,before_value,after_value,reason) values(p_admin,'student_delete',to_jsonb(st),jsonb_build_object('id',p_student,'deleted',true),'학생 삭제 · 출결 기록 보존');
 return '{}'::jsonb;
end $$;
revoke all on function public.delete_student(uuid,uuid) from public,anon,authenticated;
grant execute on function public.delete_student(uuid,uuid) to service_role;

create or replace function public.save_student(p_admin uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then raise exception '관리자 권한이 필요합니다.';end if;
 if exists(select 1 from public.students where id=(p_payload->>'id')::uuid and deleted_at is not null) then raise exception '삭제된 학생은 수정할 수 없습니다.';end if;
 if p_payload ? 'gender' and (p_payload->>'gender' is null or p_payload->>'gender' not in ('male','female','unknown')) then raise exception '성별 값을 확인하세요.';end if;
 result:=public.app_api('student',p_payload,p_admin,null);
 if p_payload ? 'gender' then perform public.set_student_gender(p_admin,array[(result->>'id')::uuid],p_payload->>'gender');end if;
 return result;
end $$;
