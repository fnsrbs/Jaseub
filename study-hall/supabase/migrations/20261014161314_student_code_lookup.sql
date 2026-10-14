-- Plain login codes are encrypted in Vault and returned only to administrators.
create or replace function public.issue_student_code(p_admin uuid,p_student uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare new_code text; digest text; attempt int; secret_id uuid;
begin
 if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then raise exception '관리자 권한이 필요합니다.';end if;
 perform pg_advisory_xact_lock(72175);
 for attempt in 1..100 loop
  new_code:=public.new_login_code();digest:=public.code_digest(new_code);
  if not exists(select 1 from public.student_codes where code_hash=digest) and not exists(select 1 from public.teacher_viewer_code where code_hash=digest) then
   perform public.app_api('code',jsonb_build_object('student_id',p_student,'code_hash',digest),p_admin,null);
   select id into secret_id from vault.decrypted_secrets where name='study_hall_student_code_'||p_student;
   if secret_id is null then perform vault.create_secret(new_code,'study_hall_student_code_'||p_student,'Current student login code');
   else perform vault.update_secret(secret_id,new_code);end if;
   return jsonb_build_object('code',new_code);
  end if;
 end loop;
 raise exception '코드 발급을 다시 시도하세요.';
end $$;

create function public.student_code(p_admin uuid,p_student uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare st public.students; code_value text;
begin
 if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then raise exception '관리자 권한이 필요합니다.';end if;
 select * into st from public.students where id=p_student for share;
 if st.id is null or not st.active or st.deleted_at is not null then raise exception '이용 가능한 학생이 아닙니다.';end if;
 select decrypted_secret into code_value from vault.decrypted_secrets where name='study_hall_student_code_'||p_student;
 if code_value is null then raise exception '발급된 코드가 없습니다. 코드 발급을 먼저 실행하세요.';end if;
 if not exists(select 1 from public.student_codes where student_id=p_student and code_hash=public.code_digest(code_value)) then raise exception '코드가 변경되었습니다. 다시 발급하세요.';end if;
 return jsonb_build_object('code',code_value,'student_id',p_student);
end $$;
revoke all on function public.student_code(uuid,uuid) from public,anon,authenticated;
grant execute on function public.student_code(uuid,uuid) to service_role;
create or replace function public.delete_student(p_admin uuid,p_student uuid) returns jsonb language plpgsql security definer set search_path='' as $$
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
 delete from vault.secrets where name='study_hall_student_code_'||p_student;
 insert into public.audits(actor,kind,before_value,after_value,reason) values(p_admin,'student_delete',to_jsonb(st),jsonb_build_object('id',p_student,'deleted',true),'학생 삭제 · 출결 기록 보존');
 return '{}'::jsonb;
end $$;
