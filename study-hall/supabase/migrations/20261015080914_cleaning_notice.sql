create table public.cleaning_notice (
 id boolean primary key default true check(id),
 body text not null check(length(trim(body)) between 1 and 3000),
 revision int not null default 1 check(revision>0)
);
insert into public.cleaning_notice(body) values('청소 당번은 3학년부에서 청소 도구를 가져와 청소해 주세요. 창문을 열어 환기하고, 청소가 끝나면 도구를 제자리에 반납해 주세요.');
alter table public.cleaning_notice enable row level security;
revoke all on public.cleaning_notice from public,anon,authenticated;
create policy deny_client on public.cleaning_notice as restrictive for all to anon,authenticated using(false) with check(false);
create function public.cleaning_notice_api(p_action text,p_payload jsonb default '{}',p_admin uuid default null,p_viewer_session text default null,p_student_session text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare old public.cleaning_notice; saved public.cleaning_notice;
begin
 perform public.cleaning_api('read','{}',p_admin,p_viewer_session,p_student_session);
 if p_action='read' then return (select jsonb_build_object('body',body,'revision',revision) from public.cleaning_notice where id=true);end if;
 if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then raise exception '안내 메시지 수정은 관리자만 가능합니다.';end if;
 if p_action<>'save' then raise exception '지원하지 않는 요청입니다.';end if;
 select * into old from public.cleaning_notice where id=true for update;
 if old.revision is distinct from (p_payload->>'revision')::int then raise exception '다른 변경이 있습니다. 다시 조회하세요.';end if;
 if jsonb_typeof(p_payload->'body') is distinct from 'string' or length(trim(p_payload->>'body')) not between 1 and 3000 then raise exception '안내 메시지는 1~3000자로 입력하세요.';end if;
 update public.cleaning_notice set body=trim(p_payload->>'body'),revision=revision+1 where id=true returning * into saved;
 insert into public.audits(actor,kind,before_value,after_value,reason) values(p_admin,'cleaning_notice',to_jsonb(old),to_jsonb(saved),'청소 안내 메시지 수정');
 return jsonb_build_object('body',saved.body,'revision',saved.revision);
end $$;
revoke all on function public.cleaning_notice_api(text,jsonb,uuid,text,text) from public,anon,authenticated;
grant execute on function public.cleaning_notice_api(text,jsonb,uuid,text,text) to service_role;
