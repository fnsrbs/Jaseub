create table public.cleaning_slots (
 day date primary key,
 student_ids uuid[] not null default '{}',
 note text not null default '' check(length(note)<=500),
 revision int not null default 1 check(revision>0),
 updated_at timestamptz not null default now()
);
alter table public.cleaning_slots enable row level security;
revoke all on public.cleaning_slots from public,anon,authenticated;
create policy deny_client on public.cleaning_slots as restrictive for all to anon,authenticated using(false) with check(false);
create function public.cleaning_api(p_action text,p_payload jsonb default '{}',p_admin uuid default null,p_viewer_session text default null,p_student_session text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare is_admin boolean:=p_admin is not null and exists(select 1 from public.admins where user_id=p_admin); allowed boolean:=false; item jsonb; old public.cleaning_slots; saved public.cleaning_slots; ids uuid[]; changes jsonb:='[]';
begin
 if is_admin then allowed:=true;
 elsif p_viewer_session is not null then
  select exists(select 1 from public.teacher_viewer_sessions s join public.teacher_viewer_code c on c.id=true and c.version=s.version where s.token_hash=p_viewer_session and s.expires_at>now()) into allowed;
 elsif p_student_session is not null then
  select exists(select 1 from public.student_sessions ss join public.student_codes c on c.student_id=ss.student_id and c.version=ss.version join public.students s on s.id=ss.student_id where ss.token_hash=p_student_session and ss.expires_at>now() and s.active and s.deleted_at is null) into allowed;
 end if;
 if not allowed then raise exception '로그인이 필요합니다.';end if;
 if p_action='read' then return coalesce((select jsonb_agg(jsonb_build_object('day',c.day,'note',c.note,'revision',c.revision,'students',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'number',s.number,'name',s.name) order by s.number) from public.students s where s.id=any(c.student_ids)),'[]'::jsonb)) order by c.day) from public.cleaning_slots c),'[]'::jsonb);end if;
 if not is_admin then raise exception '청소 당번표 수정은 관리자만 가능합니다.';end if;
 if p_action not in ('save','delete') then raise exception '지원하지 않는 요청입니다.';end if;
 perform pg_catalog.pg_advisory_xact_lock(72180);
 if p_action='delete' then
  select * into old from public.cleaning_slots where day=(p_payload->>'day')::date for update;
  if old.day is null or old.revision is distinct from (p_payload->>'revision')::int then raise exception '다른 변경이 있습니다. 다시 조회하세요.';end if;
  delete from public.cleaning_slots where day=old.day;
  insert into public.audits(actor,kind,before_value,reason) values(p_admin,'cleaning_delete',to_jsonb(old),'청소 당번표 삭제');
  return '{}'::jsonb;
 end if;
 if jsonb_typeof(p_payload->'slots') is distinct from 'array' or jsonb_array_length(p_payload->'slots') not between 1 and 100 then raise exception '청소 당번표 항목을 확인하세요.';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'slots') x group by x->>'day' having count(*)>1) then raise exception '청소 날짜가 중복되었습니다.';end if;
 for item in select value from jsonb_array_elements(p_payload->'slots') loop
  if item->>'day' is null or jsonb_typeof(item->'student_ids') is distinct from 'array' then raise exception '청소 날짜·학생을 확인하세요.';end if;
  select coalesce(array_agg(v::uuid),'{}') into ids from jsonb_array_elements_text(item->'student_ids') v;
  if cardinality(ids)<>(select count(distinct v) from unnest(ids) v) then raise exception '같은 학생이 중복되었습니다.';end if;
  if exists(select 1 from unnest(ids) as chosen(student_id) where not exists(select 1 from public.students s where s.id=chosen.student_id and s.active and s.deleted_at is null)) then raise exception '이용 가능한 학생만 배정하세요.';end if;
  select * into old from public.cleaning_slots where day=(item->>'day')::date for update;
  if coalesce((item->>'revision')::int,0)<>coalesce(old.revision,0) then raise exception '다른 변경이 있습니다. 다시 조회하세요.';end if;
  insert into public.cleaning_slots(day,student_ids,note) values((item->>'day')::date,ids,trim(coalesce(item->>'note','')))
   on conflict(day) do update set student_ids=excluded.student_ids,note=excluded.note,revision=public.cleaning_slots.revision+1,updated_at=now() returning * into saved;
  changes:=changes||jsonb_build_array(jsonb_build_object('before',case when old.day is null then null else to_jsonb(old) end,'after',to_jsonb(saved)));
 end loop;
 insert into public.audits(actor,kind,after_value,reason) values(p_admin,'cleaning_save',changes,'청소 당번표 수정');
 return jsonb_build_object('saved',jsonb_array_length(changes));
end $$;
revoke all on function public.cleaning_api(text,jsonb,uuid,text,text) from public,anon,authenticated;
grant execute on function public.cleaning_api(text,jsonb,uuid,text,text) to service_role;
