create or replace function public.poll_api(p_action text,p_payload jsonb default '{}',p_admin uuid default null,p_viewer_session text default null,p_student_session text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 is_admin boolean:=p_admin is not null and exists(select 1 from public.admins where user_id=p_admin);
 allowed boolean:=false; sid uuid; chosen public.polls; title_value text; options_value jsonb; choice_value int;
begin
 if is_admin then allowed:=true;
 elsif p_viewer_session is not null then
  select exists(select 1 from public.teacher_viewer_sessions s join public.teacher_viewer_code c on c.id=true and c.version=s.version where s.token_hash=p_viewer_session and s.expires_at>now()) into allowed;
 elsif p_student_session is not null then
  select s.id into sid from public.student_sessions ss join public.student_codes c on c.student_id=ss.student_id and c.version=ss.version join public.students s on s.id=ss.student_id where ss.token_hash=p_student_session and ss.expires_at>now() and s.active and s.deleted_at is null;
  allowed:=sid is not null;
 end if;
 if not allowed then raise exception '로그인이 필요합니다.'; end if;
 if p_action='polls' then
  return coalesce((select jsonb_agg(jsonb_build_object(
   'id',p.id,'title',p.title,'options',p.options,'anonymous',p.anonymous,'closed',p.closed,'created_at',p.created_at,
   'total',case when is_admin or p.closed then (select count(*) from public.poll_votes v where v.poll_id=p.id) else null end,
   'counts',case when is_admin or p.closed then (select jsonb_agg((select count(*) from public.poll_votes v where v.poll_id=p.id and v.choice=i) order by i) from generate_series(0,jsonb_array_length(p.options)-1) i) else null end,
   'my_choice',(select v.choice from public.poll_votes v where v.poll_id=p.id and v.student_id=sid),
   'voters',case when is_admin and not p.anonymous then coalesce((select jsonb_agg(jsonb_build_object('number',s.number,'name',s.name,'choice',v.choice) order by s.number) from public.poll_votes v join public.students s on s.id=v.student_id where v.poll_id=p.id),'[]'::jsonb) else '[]'::jsonb end
  ) order by p.created_at desc,p.id) from public.polls p),'[]'::jsonb);
 end if;
 if p_action in ('poll_create','poll_update') then
  if not is_admin then raise exception '관리자만 투표를 만들 수 있습니다.'; end if;
  title_value:=trim(coalesce(p_payload->>'title','')); options_value:=p_payload->'options';
  if length(title_value) not between 1 and 120 or jsonb_typeof(options_value) is distinct from 'array' or jsonb_typeof(p_payload->'anonymous') is distinct from 'boolean' then raise exception '제목·선택지·공개 방식을 확인하세요.'; end if;
  if jsonb_array_length(options_value) not between 2 and 10 then raise exception '선택지는 2~10개 입력하세요.'; end if;
  if exists(select 1 from jsonb_array_elements(options_value) x where jsonb_typeof(x) is distinct from 'string' or length(trim(x#>>'{}')) not between 1 and 100) or (select count(distinct trim(x)) from jsonb_array_elements_text(options_value) x)<>jsonb_array_length(options_value) then raise exception '선택지를 중복 없이 1~100자로 입력하세요.'; end if;
  select jsonb_agg(trim(x) order by n) into options_value from jsonb_array_elements_text(options_value) with ordinality a(x,n);
  if p_action='poll_update' then
   select * into chosen from public.polls where id=(p_payload->>'id')::uuid for update;
   if chosen.id is null then raise exception '투표를 찾을 수 없습니다.'; end if;
   if chosen.anonymous is distinct from (p_payload->>'anonymous')::boolean then raise exception '공개 방식은 변경할 수 없습니다.'; end if;
   if exists(select 1 from public.poll_votes where poll_id=chosen.id) and chosen.options is distinct from options_value then raise exception '참여자가 있는 투표는 제목만 수정할 수 있습니다.'; end if;
   if p_payload->>'expected_title' is distinct from chosen.title or p_payload->'expected_options' is distinct from chosen.options then raise exception '다른 변경이 있습니다. 새로고침 후 다시 수정하세요.'; end if;
   update public.polls set title=title_value,options=options_value where id=chosen.id;
  else
   insert into public.polls(title,options,anonymous) values(title_value,options_value,(p_payload->>'anonymous')::boolean);
  end if;
  return '{}'::jsonb;
 end if;
 if p_action not in ('poll_vote','poll_close') then raise exception '지원하지 않는 요청입니다.'; end if;
 if p_action='poll_close' and not is_admin then raise exception '관리자만 마감할 수 있습니다.'; end if;
 if p_action='poll_vote' and sid is null then raise exception '학생만 참여할 수 있습니다.'; end if;
 -- The same row lock serializes voting and closing; the primary key also
 -- prevents duplicate ballots across simultaneous requests and sessions.
 select * into chosen from public.polls where id=(p_payload->>'id')::uuid for update;
 if chosen.id is null then raise exception '투표를 찾을 수 없습니다.'; end if;
 if p_action='poll_close' then
  update public.polls set closed=true where id=chosen.id;
  return '{}'::jsonb;
 end if;
 if chosen.closed then raise exception '마감된 투표입니다.'; end if;
 if jsonb_typeof(p_payload->'choice') is distinct from 'number' or coalesce(p_payload->>'choice','') !~ '^[0-9]+$' then raise exception '선택지를 확인하세요.'; end if;
 choice_value:=(p_payload->>'choice')::int;
 if choice_value>=jsonb_array_length(chosen.options) then raise exception '선택지를 확인하세요.'; end if;
 if exists(select 1 from public.poll_votes where poll_id=chosen.id and student_id=sid) then raise exception '이미 참여한 투표입니다.'; end if;
 insert into public.poll_votes(poll_id,student_id,choice) values(chosen.id,sid,choice_value);
 return '{}'::jsonb;
end $$;
revoke all on function public.poll_api(text,jsonb,uuid,text,text) from public,anon,authenticated;
grant execute on function public.poll_api(text,jsonb,uuid,text,text) to service_role;

