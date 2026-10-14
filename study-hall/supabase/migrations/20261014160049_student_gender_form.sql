create function public.save_student(p_admin uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if p_payload ? 'gender' and (p_payload->>'gender' is null or p_payload->>'gender' not in ('male','female','unknown')) then raise exception '성별 값을 확인하세요.';end if;
 result:=public.app_api('student',p_payload,p_admin,null);
 if p_payload ? 'gender' then perform public.set_student_gender(p_admin,array[(result->>'id')::uuid],p_payload->>'gender');end if;
 return result;
end $$;
revoke all on function public.save_student(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_student(uuid,jsonb) to service_role;
