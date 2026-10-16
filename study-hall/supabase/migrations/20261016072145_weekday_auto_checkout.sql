create table public.auto_checkout_runs (
 day date primary key,
 scheduled_at timestamptz not null,
 recorded_exit_at timestamptz not null,
 processed_at timestamptz not null default now(),
 visit_ids uuid[] not null default '{}'
);
alter table public.auto_checkout_runs enable row level security;
revoke all on public.auto_checkout_runs from public,anon,authenticated;
create policy deny_client on public.auto_checkout_runs as restrictive for all to anon,authenticated using(false) with check(false);

create function public.weekday_auto_checkout(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path='' as $$
declare local_now timestamp:=p_now at time zone 'Asia/Seoul'; cutoff timestamptz; execution_at timestamptz; closed_ids uuid[];
begin
 if extract(isodow from local_now) not between 1 and 5 then return 0; end if;
 cutoff:=(local_now::date + case when extract(isodow from local_now) in (1,2) then time '16:30' else time '15:30' end) at time zone 'Asia/Seoul';
 execution_at:=cutoff+interval '30 minutes';
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

-- Production scheduler: pg_cron uses UTC (KST - 9 hours).
create extension if not exists pg_cron;
select cron.schedule('study-hall-checkout-mon-tue','0 8 * * 1,2','select public.weekday_auto_checkout();');
select cron.schedule('study-hall-checkout-wed-fri','0 7 * * 3,4,5','select public.weekday_auto_checkout();');
-- Apply today's due run on rollout; before the deadline this is a no-op.
select public.weekday_auto_checkout();
