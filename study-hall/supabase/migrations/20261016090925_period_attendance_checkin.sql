create table public.period_attendance_checkins (
 student_id uuid not null references public.students(id),
 day date not null,
 visit_id uuid references public.visits(id) on delete set null,
 first_confirmed_at timestamptz not null,
 source_period integer not null,
 actor text not null,
 primary key(student_id,day)
);
alter table public.period_attendance_checkins enable row level security;
revoke all on public.period_attendance_checkins from public,anon,authenticated;
create policy deny_client on public.period_attendance_checkins as restrictive for all to anon,authenticated using(false) with check(false);

create function public.checkin_from_period_attendance() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid; first_seen timestamptz; cutoff timestamptz; visit uuid;
begin
 if not new.confirmed or new.day<>(now() at time zone 'Asia/Seoul')::date then return new; end if;
 cutoff:=(new.day+case when extract(isodow from new.day) in (1,2) then time '16:30' else time '15:30' end) at time zone 'Asia/Seoul';
 for target in select (e->>'student_id')::uuid from jsonb_array_elements(new.entries)e where e->>'status' in ('present','late') order by e->>'student_id' loop
  perform 1 from public.students where id=target and active and deleted_at is null for update;
  if not found then continue; end if;
  if exists(select 1 from public.period_attendance_checkins where student_id=target and day=new.day)
   or exists(select 1 from public.visits where student_id=target and (exited_at is null or (entered_at at time zone 'Asia/Seoul')::date=new.day)) then continue; end if;
  select min(e.created_at) into first_seen from public.period_attendance_events e
  cross join lateral jsonb_array_elements(case when jsonb_typeof(e.changes)='array' then e.changes else '[]'::jsonb end)c
  where e.day=new.day and c->>'student_id'=target::text and c->>'after' in ('present','late');
  first_seen:=coalesce(first_seen,now());
  insert into public.visits(student_id,entered_at,exited_at)
  values(target,first_seen,case when now()>=cutoff then greatest(first_seen,cutoff) else null end) returning id into visit;
  insert into public.period_attendance_checkins values(target,new.day,visit,first_seen,new.period,new.updated_by);
 end loop;
 return new;
end $$;
revoke all on function public.checkin_from_period_attendance() from public,anon,authenticated,service_role;
create trigger checkin_from_period_attendance after insert or update of entries,confirmed on public.period_attendance_sessions for each row execute function public.checkin_from_period_attendance();
