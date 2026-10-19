-- Add last Monday-Friday without changing daily/weekly scoring or student privacy.
do $patch$
declare definition text; updated text;
begin
 select pg_get_functiondef('public.study_ranking(text,uuid,text,text)'::regprocedure) into definition;
 updated:=replace(definition,'''day'',''week''','''day'',''week'',''previous_week''');
 if updated=definition then raise exception '순위 기간 검증 함수를 확인하세요.';end if;
 definition:=updated;
 updated:=replace(definition,'friday:=monday+4;','if p_scope=''previous_week'' then monday:=monday-7;end if;friday:=monday+4;');
 if updated=definition then raise exception '주간 순위 날짜 함수를 확인하세요.';end if;
 execute updated;
end $patch$;
