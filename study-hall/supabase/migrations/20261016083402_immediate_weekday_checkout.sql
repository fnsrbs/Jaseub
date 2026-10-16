alter table public.auto_checkout_runs add column corrections jsonb not null default '[]'::jsonb;

create or replace function public.weekday_auto_checkout(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
declare local_now timestamp:=p_now at time zone 'Asia/Seoul'; cutoff timestamptz; execution_at timestamptz; closed_ids uuid[];
begin
 if extract(isodow from local_now) not between 1 and 5 then return 0; end if;
 cutoff:=(local_now::date + case when extract(isodow from local_now) in (1,2) then time '16:30' else time '15:30' end) at time zone 'Asia/Seoul';
 execution_at:=cutoff;
 if p_now<execution_at then return 0; end if;
 perform pg_advisory_xact_lock(72186);
 if exists(select 1 from public.auto_checkout_runs where day=local_now::date) then return 0; end if;
 with closed as (
  update public.visits set exited_at=greatest(cutoff,entered_at) where exited_at is null and entered_at<=p_now returning id
 ) select coalesce(array_agg(id),'{}'::uuid[]) into closed_ids from closed;
 insert into public.auto_checkout_runs(day,scheduled_at,recorded_exit_at,processed_at,visit_ids) values(local_now::date,execution_at,cutoff,p_now,closed_ids);
 return cardinality(closed_ids);
end $$;
revoke all on function public.weekday_auto_checkout(timestamptz) from public,anon,authenticated,service_role;

-- Production scheduler:
select cron.schedule('study-hall-checkout-mon-tue','30 7 * * 1,2','select public.weekday_auto_checkout();');
select cron.schedule('study-hall-checkout-wed-fri','30 6 * * 3,4,5','select public.weekday_auto_checkout();');

-- Today's requested correction: retain early checkout, cap later checkout, preserve before/after.
do $correction$
declare selected_day date:=date '2026-10-16'; cutoff timestamptz; changed_ids uuid[]; corrections jsonb;
begin
 cutoff:=(selected_day+time '15:30') at time zone 'Asia/Seoul';
 if now()<cutoff then return; end if;
 perform pg_advisory_xact_lock(72186);
 with targets as materialized (
  select id,entered_at,exited_at from public.visits
  where entered_at>=selected_day::timestamp at time zone 'Asia/Seoul'
    and entered_at<(selected_day+1)::timestamp at time zone 'Asia/Seoul'
    and (exited_at is null or exited_at>greatest(cutoff,entered_at)) for update
 ), changed as (
  update public.visits v set exited_at=greatest(cutoff,v.entered_at) from targets t where v.id=t.id
  returning v.id,t.exited_at old_exit,v.exited_at new_exit
 ) select coalesce(array_agg(id),'{}'::uuid[]),coalesce(jsonb_agg(jsonb_build_object('visit_id',id,'before',old_exit,'after',new_exit)),'[]'::jsonb) into changed_ids,corrections from changed;
 insert into public.auto_checkout_runs(day,scheduled_at,recorded_exit_at,processed_at,visit_ids,corrections)
 values(selected_day,cutoff,cutoff,now(),changed_ids,corrections)
 on conflict(day) do update set scheduled_at=excluded.scheduled_at,recorded_exit_at=excluded.recorded_exit_at,processed_at=excluded.processed_at,
 visit_ids=array(select distinct unnest(public.auto_checkout_runs.visit_ids||excluded.visit_ids)),
 corrections=public.auto_checkout_runs.corrections||excluded.corrections;
end $correction$;
