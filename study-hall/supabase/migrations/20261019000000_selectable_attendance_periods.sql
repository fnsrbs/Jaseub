create or replace function public.period_attendance_bulk(p_payload jsonb,p_admin uuid default null,p_viewer_session text default null)
returns jsonb language plpgsql security definer set search_path='' as $bulk$
declare
 is_admin boolean:=p_admin is not null and exists(select 1 from public.admins where user_id=p_admin);
 actor_name text; selected_day date; student uuid; first_period int; last_period int; period_count int; n int; selected_periods int[];
 status text; note text; request uuid; prior_request public.period_attendance_bulk_requests;
 old public.period_attendance_sessions; roster jsonb; entries jsonb; before_entry jsonb; item jsonb;
begin
 if is_admin then actor_name:='admin:'||p_admin;
 else
  perform 1 from public.teacher_viewer_sessions s join public.teacher_viewer_code c on c.id=true and c.version=s.version where s.token_hash=p_viewer_session and s.expires_at>now() for share of s,c;
  if not found then raise exception '교사 또는 관리자 권한이 필요합니다.'; end if;
  actor_name:='teacher:'||left(p_viewer_session,12);
 end if;
 selected_day:=(p_payload->>'day')::date; student:=(p_payload->>'student_id')::uuid;
 first_period:=(p_payload->>'start_period')::int;last_period:=(p_payload->>'end_period')::int;
 status:=p_payload->>'status';note:=trim(coalesce(p_payload->>'note',''));request:=(p_payload->>'request_id')::uuid;
 if selected_day is null or student is null or request is null then raise exception '날짜·학생·저장 요청을 확인하세요.';end if;
 if not is_admin and selected_day<>(now() at time zone 'Asia/Seoul')::date then raise exception '과거·미래 날짜의 출석 변경은 관리자만 가능합니다.';end if;
 period_count:=case when extract(isodow from selected_day) in (1,2) then 7 when extract(isodow from selected_day) between 3 and 5 then 6 else 0 end;
 if p_payload ? 'periods' then
  if jsonb_typeof(p_payload->'periods') is distinct from 'array' then raise exception '교시를 선택하세요.';end if;
  if jsonb_array_length(p_payload->'periods') not between 1 and 7 then raise exception '교시를 선택하세요.';end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'periods') e where jsonb_typeof(e)<>'number' or e::text !~ '^[1-7]$') then raise exception '선택한 교시를 확인하세요.';end if;
  select array_agg(e::text::int order by e::text::int) into selected_periods from jsonb_array_elements(p_payload->'periods') e;
  if (select count(distinct x) from unnest(selected_periods) x)<>cardinality(selected_periods) or exists(select 1 from unnest(selected_periods) x where x>period_count) then raise exception '선택한 교시를 확인하세요.';end if;
 else
  if first_period is null or last_period is null or first_period<1 or last_period<first_period or last_period>period_count then raise exception '교시 범위를 확인하세요.';end if;
  select array_agg(x) into selected_periods from generate_series(first_period,last_period) x;
 end if;
 if status is null or status not in ('present','late','absent','excused') or length(note) not between 1 and 500 then raise exception '출결 상태와 사유(1~500자)를 입력하세요.';end if;
 if jsonb_typeof(p_payload->'revisions') is distinct from 'object' then raise exception '저장된 출석 버전을 확인하세요.';end if;
 if not exists(select 1 from public.students where id=student and deleted_at is null) then raise exception '학생을 확인하세요.';end if;
 perform pg_catalog.pg_advisory_xact_lock(72185);
 select * into prior_request from public.period_attendance_bulk_requests where request_id=request;
 if found then
  if prior_request.actor<>actor_name or prior_request.payload<>p_payload then raise exception '저장 요청이 중복되었습니다. 다시 시도하세요.';end if;
  return public.period_attendance_api('read',jsonb_build_object('day',selected_day),p_admin,p_viewer_session);
 end if;
 -- Check every revision first: a conflict rolls back the entire selection.
 foreach n in array selected_periods loop
  select * into old from public.period_attendance_sessions where day=selected_day and period=n for update;
  if coalesce(p_payload->'revisions'->>n::text,'') !~ '^[0-9]+$' then raise exception '저장된 출석 버전을 확인하세요.';end if;
  if (p_payload->'revisions'->>n::text)::int<>coalesce(old.revision,0) then raise exception '다른 교사가 출석을 변경했습니다. 다시 조회한 뒤 수정하세요.';end if;
 end loop;
 foreach n in array selected_periods loop
  select * into old from public.period_attendance_sessions where day=selected_day and period=n;
  if old.day is not null then roster:=old.entries;
  else
   select coalesce(jsonb_agg(jsonb_build_object('student_id',s.id,'number',s.number,'name',s.name,'seat_id',s.seat_id,'status',case when exists(select 1 from public.visits v where v.student_id=s.id and v.exited_at is null) and selected_day=(now() at time zone 'Asia/Seoul')::date then 'present' else 'absent' end,'note','') order by s.number),'[]'::jsonb) into roster from public.students s where s.active and s.deleted_at is null;
  end if;
  select e into before_entry from jsonb_array_elements(roster)e where e->>'student_id'=student::text;
  if before_entry is null then raise exception '선택한 교시의 출석 대상에 학생이 없습니다.';end if;
  select jsonb_agg(case when e->>'student_id'=student::text then e||jsonb_build_object('status',status,'note',note,'confirmed',true) else e end order by ord) into entries from jsonb_array_elements(roster) with ordinality x(e,ord);
  insert into public.period_attendance_sessions(day,period,entries,confirmed,request_id,updated_by)
   values(selected_day,n,entries,false,request,actor_name)
   on conflict(day,period) do update set entries=excluded.entries,revision=public.period_attendance_sessions.revision+1,request_id=excluded.request_id,change_id=nextval('public.period_attendance_change_seq'),updated_at=now(),updated_by=excluded.updated_by;
  insert into public.period_attendance_events(day,period,actor,action,reason,changes)
   values(selected_day,n,actor_name,'bulk','학생별 여러 교시 변경',jsonb_build_array(jsonb_build_object('student_id',student,'number',before_entry->>'number','name',before_entry->>'name','before',case when old.confirmed or before_entry->>'confirmed'='true' then before_entry->>'status' else null end,'after',status,'note',note)));
 end loop;
 insert into public.period_attendance_bulk_requests(request_id,actor,day,payload) values(request,actor_name,selected_day,p_payload);
 return public.period_attendance_api('read',jsonb_build_object('day',selected_day),p_admin,p_viewer_session);
end $bulk$;
revoke all on function public.period_attendance_bulk(jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.period_attendance_bulk(jsonb,uuid,text) to service_role;

