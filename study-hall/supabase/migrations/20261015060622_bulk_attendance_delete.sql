create function public.delete_visits(p_admin uuid,p_visits uuid[],p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare total integer := coalesce(cardinality(p_visits),0);
begin
 if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then raise exception '관리자 권한이 필요합니다.'; end if;
 if coalesce(length(trim(p_reason)),0)=0 or length(p_reason)>1000 then raise exception '삭제 사유(1~1000자)를 입력하세요.'; end if;
 if total<1 or total>1000 or array_ndims(p_visits)<>1 or exists(select 1 from unnest(p_visits) id where id is null) or (select count(distinct id) from unnest(p_visits) id)<>total then raise exception '삭제할 기록을 1~1000건 중복 없이 선택하세요.'; end if;
 -- Match single-delete/attendance lock ordering: students first, then visits.
 perform 1 from public.students where id in (select student_id from public.visits where id=any(p_visits)) order by id for update;
 perform 1 from public.visits where id=any(p_visits) order by id for update;
 if (select count(*) from public.visits where id=any(p_visits))<>total then raise exception '선택한 기록 중 이미 삭제되었거나 없는 기록이 있습니다. 다시 조회하세요.'; end if;
 insert into public.audits(actor,kind,before_value,after_value,reason)
 select p_admin,'visit_delete_bulk',to_jsonb(v),null,'출결 기록 일괄 삭제: '||trim(p_reason) from public.visits v where id=any(p_visits);
 delete from public.visits where id=any(p_visits);
 return jsonb_build_object('deleted',total);
end $$;
revoke all on function public.delete_visits(uuid,uuid[],text) from public,anon,authenticated;
grant execute on function public.delete_visits(uuid,uuid[],text) to service_role;
