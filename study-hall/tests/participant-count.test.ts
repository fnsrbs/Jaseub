import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { participantCount, type Student } from "../src/domain";

test("홈 전체 인원은 서버의 참여 인원 사용: 개인 명단·0명·이용 중지 구분", () => {
  const students = [
    { id: "one", active: true, deleted_at: null },
    { id: "two", active: false, deleted_at: null },
    { id: "three", active: true, deleted_at: "2026-10-23" },
  ] as Student[];
  const settings = { capacity: 72, exam_date: null, missing_hours: 16 };
  assert.equal(participantCount({ students, settings }), 1);
  assert.equal(
    participantCount({
      students: students.slice(0, 1),
      settings: { ...settings, participant_count: 68 },
    }),
    68,
  );
  assert.equal(
    participantCount({
      students,
      settings: { ...settings, participant_count: 0 },
    }),
    0,
  );
});

test("서버 전체 인원: 참여 중단·복구 즉시 계산하며 개인 조회 범위와 기존 설정 보존", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table students(id int,active boolean,deleted_at timestamptz);
      insert into students values(1,true,null),(2,true,null),(3,false,null),(4,true,now());
      create function snapshot_with_warnings(p_admin uuid default null,p_session text default null,p_viewer_session text default null) returns jsonb language plpgsql as $$
      declare result jsonb; begin
        if p_admin is null and coalesce(p_session,'') <> 'valid' and coalesce(p_viewer_session,'') <> 'valid' then raise exception '인증 필요'; end if;
        result:=jsonb_build_object('settings',jsonb_build_object('capacity',72),'students',jsonb_build_array(jsonb_build_object('id',1)));
        return result || jsonb_build_object('warnings','[]'::jsonb);
      end $$;
    `);
    await db.exec(
      fs.readFileSync(
        new URL(
          "../supabase/migrations/20261023051512_automatic_participant_count.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const read = async (session = "valid") =>
      (
        await db.query<{ r: any }>(
          "select snapshot_with_warnings(null,$1,null) r",
          [session],
        )
      ).rows[0].r;
    let result = await read();
    assert.equal(result.settings.participant_count, 2);
    assert.equal(result.settings.capacity, 72);
    assert.equal(result.students.length, 1);
    await db.exec("update students set active=false where id=2");
    assert.equal((await read()).settings.participant_count, 1);
    await db.exec("update students set active=true where id=2");
    assert.equal((await read()).settings.participant_count, 2);
    await db.exec("update students set active=false");
    assert.equal((await read()).settings.participant_count, 0);
    await assert.rejects(read("invalid"), /인증/);
  } finally {
    await db.close();
  }
});
