create or replace function public.sync_roster_participation(p_admin uuid,p_students jsonb,p_participation jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item jsonb; st public.students; imported jsonb; stopped int:=0; restored int:=0; changes jsonb:='[]'; was_active boolean; open_visits jsonb;
begin
 if p_admin is null or not exists(select 1 from public.admins where user_id=p_admin) then raise exception '관리자 권한이 필요합니다.'; end if;
 if jsonb_typeof(p_participation) is distinct from 'array' or jsonb_array_length(p_participation) not between 1 and 2400 then raise exception '전체 명단 참여 중단 목록을 확인하세요.'; end if;
 if exists(select 1 from jsonb_array_elements(p_participation) s where jsonb_typeof(s->'number') is distinct from 'string' or trim(s->>'number') !~ '^[0-9]{5}$' or jsonb_typeof(s->'stopped') is distinct from 'boolean') then raise exception '전체 명단 학번·중단 체크를 확인하세요.'; end if;
 if exists(select 1 from jsonb_array_elements(p_participation) s group by trim(s->>'number') having count(*)>1) then raise exception '전체 명단 학번이 중복되었습니다.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(72172);
 perform pg_catalog.pg_advisory_xact_lock(72175);
 -- Add only students on the confirmed attendance roster; the master also contains applicants.
 imported:=public.import_roster_students(p_admin,p_students);
 -- Process stops first so their released capacity is available for restores.
 for item in select value from jsonb_array_elements(p_participation) order by (value->>'stopped')::boolean desc loop
  select * into st from public.students where number=trim(item->>'number') and deleted_at is null for update;
  if not found then continue; end if;
  if (item->>'stopped')::boolean then
   if st.participation_stopped and not st.active and st.seat_id is null then continue; end if;
   was_active:=case when st.participation_stopped then st.participation_restore_active else st.active end;
   select coalesce(jsonb_agg(to_jsonb(v)),'[]') into open_visits from public.visits v where student_id=st.id and exited_at is null;
   update public.visits set exited_at=greatest(entered_at,clock_timestamp()) where student_id=st.id and exited_at is null;
   update public.students set active=false,seat_id=null,participation_stopped=true,participation_restore_active=was_active where id=st.id;
   delete from public.student_sessions where student_id=st.id;
   update public.student_codes set version=version+1 where student_id=st.id;
   changes:=changes||jsonb_build_array(jsonb_build_object('before',to_jsonb(st),'open_visits',open_visits,'after',jsonb_build_object('id',st.id,'participation_stopped',true,'active',false,'seat_id',null)));
   stopped:=stopped+1;
  elsif st.participation_stopped then
   if st.participation_restore_active and not st.active and (select count(*) from public.students where active and deleted_at is null)>=(select capacity from public.settings where id=true) then raise exception '참여 복구 시 정원을 초과합니다. 운영 정원과 명단을 확인하세요.'; end if;
   update public.students set active=st.participation_restore_active,participation_stopped=false,participation_restore_active=false where id=st.id;
   changes:=changes||jsonb_build_array(jsonb_build_object('before',to_jsonb(st),'after',jsonb_build_object('id',st.id,'participation_stopped',false,'active',st.participation_restore_active)));
   restored:=restored+1;
  end if;
 end loop;
 if jsonb_array_length(changes)>0 then insert into public.audits(actor,kind,after_value,reason) values(p_admin,'roster_participation',changes,'구글 전체 명단 참여 중단·복구 반영 · 기존 기록 보존'); end if;
 return imported||jsonb_build_object('stopped',stopped,'restored',restored,'participation_changes',
   coalesce((select jsonb_agg(jsonb_build_object('id',c->'before'->>'id','number',c->'before'->>'number','name',c->'before'->>'name',
    'kind',case when (c->'after'->>'participation_stopped')::boolean then 'stopped' else 'restored' end,
    'active',(c->'after'->>'active')::boolean,'previous_seat',c->'before'->'seat_id')) from jsonb_array_elements(changes) c),'[]'::jsonb));
end $$;
revoke all on function public.sync_roster_participation(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.sync_roster_participation(uuid,jsonb,jsonb) to service_role;
