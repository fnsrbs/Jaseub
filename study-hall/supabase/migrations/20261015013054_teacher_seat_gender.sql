-- Keep the teacher roster explicit: expose seat gender/status, never login codes.
create or replace function public.teacher_viewer_api(p_action text,p_payload jsonb default '{}',p_session text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg public.teacher_viewer_code; expiry timestamptz;
begin
 select * into cfg from public.teacher_viewer_code where id=true for share;
 if p_action='login' then
  if cfg.id is null or cfg.code_hash is distinct from p_payload->>'code_hash' then raise exception '교사용 코드를 확인하세요.'; end if;
  if coalesce(p_payload->>'token_hash','') !~ '^[a-f0-9]{64}$' then raise exception '세션 형식 오류'; end if;
  expiry := now()+interval '8 hours';
  delete from public.teacher_viewer_sessions where expires_at<now();
  insert into public.teacher_viewer_sessions values(p_payload->>'token_hash',cfg.version,expiry);
  return jsonb_build_object('role','viewer','expires_at',expiry);
 end if;
 if not exists(select 1 from public.teacher_viewer_sessions where token_hash=p_session and version=cfg.version and expires_at>now()) then raise exception '교사 세션이 만료되었거나 코드가 재발급되었습니다.'; end if;
 if p_action='logout' then delete from public.teacher_viewer_sessions where token_hash=p_session; return '{}'::jsonb; end if;
 if p_action<>'snapshot' then raise exception '교사는 조회만 가능합니다.'; end if;
 return jsonb_build_object(
  'students',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'number',s.number,'seat_id',s.seat_id,'active',s.active,'gender',s.gender,'deleted_at',s.deleted_at) order by s.number) from public.students s),'[]'::jsonb),
  'seats',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.seats s),'[]'::jsonb),
  'visits',coalesce((select jsonb_agg(to_jsonb(v) order by v.entered_at desc) from public.visits v),'[]'::jsonb),
  'notices',coalesce((select jsonb_agg(to_jsonb(n) order by n.important desc,n.created_at desc) from public.notices n),'[]'::jsonb),
  'settings',(select to_jsonb(s)-'id' from public.settings s),
  'operating_days',coalesce((select jsonb_agg(to_jsonb(d)) from public.operating_days d),'[]'::jsonb),
  'suggestions',coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc) from public.suggestions s),'[]'::jsonb),'audits','[]'::jsonb,'server_now',now(),
  'current',(select count(*) from public.visits where exited_at is null),
  'today',(select count(distinct student_id) from public.visits where entered_at>=(date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'))
 );
end $$;
