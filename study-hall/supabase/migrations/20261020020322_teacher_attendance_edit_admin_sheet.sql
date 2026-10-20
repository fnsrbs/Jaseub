-- Teachers may edit attendance on any date; sheet credentials and sync remain admin-only.
do $migration$
declare signature text; definition text; patched text;
begin
 foreach signature in array array['public.period_attendance_api(text,jsonb,uuid,text)','public.period_attendance_bulk(jsonb,uuid,text)'] loop
  definition := pg_get_functiondef(signature::regprocedure);
  patched := regexp_replace(definition, 'if not is_admin and selected_day<>[^;]+ then raise exception ''과거·미래 날짜의 출석 변경은 관리자만 가능합니다\.'';\s*end if;', '', 'g');
  if patched=definition then raise exception 'Attendance date guard not found: %',signature; end if;
  if signature like '%period_attendance_api(%' then
   patched := replace(patched, 'if p_action=''sync_payload'' then', 'if p_action in (''sync_payload'',''mark_synced'') and not is_admin then raise exception ''구글 시트 반영은 관리자만 가능합니다.''; end if; if p_action=''sync_payload'' then');
  end if;
  execute patched;
 end loop;
end
$migration$;
