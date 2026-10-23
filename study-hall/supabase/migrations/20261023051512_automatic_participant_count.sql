-- Compute after authorization and before returning any administrator, viewer,
-- or student snapshot. Student snapshots intentionally contain only that student.
do $count$
declare definition text;
begin
 select pg_get_functiondef('public.snapshot_with_warnings(uuid,text,text)'::regprocedure) into definition;
 if position('return result ||' in definition)=0 then raise exception '학생 화면 조회 함수를 확인하세요.'; end if;
 execute replace(definition,'return result ||',
  'result := jsonb_set(result,''{settings,participant_count}'',to_jsonb((select count(*) from public.students where active and deleted_at is null))); return result ||');
end $count$;
