import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("출결 집계: 본인만 조회, 만료 차단, 확정만 집계, 수정·초기화 반영", async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
 create table admins(user_id uuid);create table students(id uuid,active boolean,deleted_at timestamptz);
 create table student_codes(student_id uuid,version int); create table student_sessions(student_id uuid,version int,token_hash text,expires_at timestamptz);
 create table teacher_viewer_code(id boolean,version int);create table teacher_viewer_sessions(token_hash text,version int,expires_at timestamptz);
 create table period_attendance_sessions(day date,period int,entries jsonb,confirmed boolean);
 create function menu_order_api(text,jsonb,uuid,text,text) returns jsonb language sql as 'select ''{}''::jsonb';
 insert into students values('00000000-0000-0000-0000-000000000001',true,null),('00000000-0000-0000-0000-000000000002',true,null);
 insert into student_codes select id,1 from students;
 insert into student_sessions select id,1,case when id::text like '%1' then 'own' else 'other' end,now()+interval '1 day' from students;
 insert into teacher_viewer_code values(true,1);insert into teacher_viewer_sessions values('viewer',1,now()+interval '1 day');
 insert into period_attendance_sessions values('2026-10-16',1,'[{"student_id":"00000000-0000-0000-0000-000000000001","status":"absent","note":"본인"},{"student_id":"00000000-0000-0000-0000-000000000002","status":"late","note":"비공개"}]',true),('2026-10-16',2,'[{"student_id":"00000000-0000-0000-0000-000000000001","status":"present"}]',false);`);
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261016065620_attendance_summary.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/20261016083447_daily_attendance_summary.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const query = async (
    payload: any = {},
    student: string | null = "own",
    viewer: string | null = null,
  ) =>
    (
      await db.query<{ r: any }>(`select attendance_summary($1,null,$2,$3) r`, [
        { start: "2026-10-01", end: "2026-10-31", ...payload },
        viewer,
        student,
      ])
    ).rows[0].r;
  let r = await query();
  assert.equal(r.total, 1);
  assert.equal(r.summaries[0].absent, 1);
  assert.ok(!JSON.stringify(r).includes("비공개"));
  await assert.rejects(
    query({ student_id: "00000000-0000-0000-0000-000000000002" }),
    /본인/,
  );
  await assert.rejects(query({}, "expired"), /만료/);
  await assert.rejects(query({}, null), /로그인/);
  r = await query({}, null, "viewer");
  assert.equal(r.summaries.length, 2);
  assert.equal(r.records.length, 0);
  await db.exec(`update period_attendance_sessions set confirmed=true where period=2;
    insert into period_attendance_sessions values('2026-10-16',3,'[{"student_id":"00000000-0000-0000-0000-000000000001","status":"present"}]',true),('2026-10-15',1,'[{"student_id":"00000000-0000-0000-0000-000000000001","status":"present"}]',true);`);
  r = await query();
  assert.equal(r.summaries[0].present, 2);
  assert.equal(r.total, 1);
  assert.ok(r.records.every((v: any) => v.status !== "present"));
  await db.exec(
    `update period_attendance_sessions set entries=jsonb_set(entries,'{0,status}','"late"') where period=1 and day='2026-10-16'`,
  );
  r = await query();
  assert.equal(r.summaries[0].absent, 0);
  assert.equal(r.summaries[0].late, 1);
  await db.exec(
    `update period_attendance_sessions set confirmed=false where period=1 and day='2026-10-16'`,
  );
  r = await query();
  assert.equal(r.total, 0);
  await db.close();
});
