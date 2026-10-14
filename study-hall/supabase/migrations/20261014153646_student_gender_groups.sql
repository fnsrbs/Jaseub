alter table public.students add column gender text not null default 'unknown' check(gender in ('male','female','unknown'));
create function public.set_student_gender(p_admin uuid,p_ids uuid[],p_gender text) returns jsonb language plpgsql security definer set search_path='' as $$
declare old_rows jsonb;
begin
 if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then raise exception '관리자 권한이 필요합니다.'; end if;
 if p_gender is null or p_gender not in ('male','female','unknown') then raise exception '성별 값을 확인하세요.'; end if;
 if coalesce(cardinality(p_ids),0)=0 or cardinality(p_ids)>1000 then raise exception '학생을 선택하세요.'; end if;
 if exists(select 1 from unnest(p_ids) as wanted(student_id) where wanted.student_id is null or not exists(select 1 from public.students s where s.id=wanted.student_id)) then raise exception '학생을 찾을 수 없습니다.'; end if;
 perform 1 from public.students where id=any(p_ids) order by id for update;
 select jsonb_agg(jsonb_build_object('id',id,'gender',gender)) into old_rows from public.students where id=any(p_ids);
 update public.students set gender=p_gender where id=any(p_ids);
 insert into public.audits(actor,kind,before_value,after_value,reason) values(p_admin,'student_gender',old_rows,jsonb_build_object('ids',p_ids,'gender',p_gender),'확인된 학생 성별 지정');
 return jsonb_build_object('updated',(select count(*) from public.students where id=any(p_ids)));
end $$;
revoke all on function public.set_student_gender(uuid,uuid[],text) from public,anon,authenticated;
grant execute on function public.set_student_gender(uuid,uuid[],text) to service_role;

