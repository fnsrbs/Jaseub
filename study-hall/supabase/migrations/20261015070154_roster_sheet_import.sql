create function public.import_roster_students(p_admin uuid,p_students jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item jsonb; student_id uuid; added int:=0; skipped int:=0; result jsonb:='[]';
begin
 if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then raise exception '관리자 권한이 필요합니다.'; end if;
 if jsonb_typeof(p_students) is distinct from 'array' or jsonb_array_length(p_students) not between 1 and 995 then raise exception '출석부 학생 목록을 확인하세요.';end if;
 if exists(select 1 from jsonb_array_elements(p_students) s where jsonb_typeof(s->'number') is distinct from 'string' or jsonb_typeof(s->'name') is distinct from 'string' or trim(s->>'number') !~ '^[0-9]{5}$' or length(trim(s->>'name')) not between 1 and 80) then raise exception '출석부 학번·이름을 확인하세요.';end if;
 if exists(select 1 from jsonb_array_elements(p_students) s group by trim(s->>'number') having count(*)>1) then raise exception '출석부 학번이 중복되었습니다.';end if;
 perform pg_catalog.pg_advisory_xact_lock(72172);
 perform pg_catalog.pg_advisory_xact_lock(72175);
 for item in select value from jsonb_array_elements(p_students) loop
  student_id:=null;
  insert into public.students(number,name,gender) values(trim(item->>'number'),trim(item->>'name'),'unknown') on conflict(number) do nothing returning id into student_id;
  if student_id is null then skipped:=skipped+1;continue;end if;
  perform public.issue_student_code(p_admin,student_id);
  result:=result||jsonb_build_array(jsonb_build_object('id',student_id,'number',trim(item->>'number'),'name',trim(item->>'name')));
  added:=added+1;
 end loop;
 insert into public.audits(actor,kind,after_value,reason) values(p_admin,'roster_import',jsonb_build_object('added',result,'skipped',skipped),'구글 출석부 신규 학생 추가');
 return jsonb_build_object('added',added,'skipped',skipped,'students',result);
end $$;
revoke all on function public.import_roster_students(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.import_roster_students(uuid,jsonb) to service_role;
