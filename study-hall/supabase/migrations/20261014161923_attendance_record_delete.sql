create function public.delete_visit(p_admin uuid,p_visit uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare st_id uuid; vi public.visits;
begin
 if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then raise exception '관리자 권한이 필요합니다.';end if;
 if coalesce(length(trim(p_reason)),0)=0 or length(p_reason)>1000 then raise exception '삭제 사유를 입력하세요.';end if;
 select student_id into st_id from public.visits where id=p_visit;
 if st_id is null then raise exception '출결 기록을 찾을 수 없습니다.';end if;
 perform 1 from public.students where id=st_id for update;
 select * into vi from public.visits where id=p_visit for update;
 if vi.id is null then raise exception '출결 기록을 찾을 수 없습니다.';end if;
 insert into public.audits(actor,kind,before_value,after_value,reason) values(p_admin,'visit_delete',to_jsonb(vi),null,'출결 기록 삭제: '||trim(p_reason));
 delete from public.visits where id=p_visit;
 return jsonb_build_object('id',p_visit,'deleted',true);
end $$;
revoke all on function public.delete_visit(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.delete_visit(uuid,uuid,text) to service_role;
