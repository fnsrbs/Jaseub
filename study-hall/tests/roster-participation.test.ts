import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("구글 참여 중단: 관리자만 처리·좌석 해제·세션 폐기·기록 보존·복구·실패 롤백", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table admins(user_id uuid primary key);
      create table students(id uuid primary key,number text unique,name text,active boolean,seat_id integer,deleted_at timestamptz);
      create table visits(id integer,student_id uuid,entered_at timestamptz,exited_at timestamptz);
      create table student_sessions(student_id uuid);
      create table student_codes(student_id uuid,version integer);
      create table settings(id boolean,capacity integer);
      create table audits(actor uuid,kind text,after_value jsonb,reason text);
      create function import_roster_students(uuid,jsonb) returns jsonb language sql as 'select jsonb_build_object(''added'',0,''skipped'',2)';
      insert into admins values('00000000-0000-0000-0000-000000000001');
      insert into settings values(true,2);
      insert into students values('00000000-0000-0000-0000-000000000002','30101','가상학생',true,1,null),('00000000-0000-0000-0000-000000000003','30102','기존이용중지',false,null,null);
      insert into visits values(1,'00000000-0000-0000-0000-000000000002',now()-interval '1 hour',null);
      insert into student_sessions values('00000000-0000-0000-0000-000000000002');
      insert into student_codes values('00000000-0000-0000-0000-000000000002',1);
    `);
    await db.exec(
      fs.readFileSync(
        new URL(
          "../supabase/migrations/20261023002152_roster_participation_sync.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const admin = "00000000-0000-0000-0000-000000000001";
    const sync = async (stopped: boolean, who: string | null = admin) =>
      (
        await db.query<{ r: any }>(
          "select sync_roster_participation($1,'[]',$2) r",
          [
            who,
            JSON.stringify([
              { number: "30101", stopped },
              { number: "30102", stopped },
            ]),
          ],
        )
      ).rows[0].r;
    await assert.rejects(sync(true, null), /관리자/);
    assert.equal((await sync(true)).stopped, 2);
    const st = (
      await db.query<any>("select * from students where number='30101'")
    ).rows[0];
    assert.equal(st.active, false);
    assert.equal(st.seat_id, null);
    assert.equal(st.deleted_at, null);
    assert.equal(
      (await db.query("select * from student_sessions")).rows.length,
      0,
    );
    assert.equal(
      (await db.query<any>("select version from student_codes")).rows[0]
        .version,
      2,
    );
    assert.ok(
      (await db.query<any>("select exited_at from visits")).rows[0].exited_at,
    );
    assert.equal((await sync(true)).stopped, 0);
    assert.equal((await sync(false)).restored, 2);
    assert.equal(
      (await db.query<any>("select active from students where number='30101'"))
        .rows[0].active,
      true,
    );
    assert.equal(
      (await db.query<any>("select active from students where number='30102'"))
        .rows[0].active,
      false,
    );
    assert.equal(
      (await db.query<any>("select seat_id from students where number='30101'"))
        .rows[0].seat_id,
      null,
    );
    await sync(true);
    await db.exec("update settings set capacity=0");
    await assert.rejects(sync(false), /정원/);
    assert.equal(
      (
        await db.query<any>(
          "select participation_stopped from students where number='30101'",
        )
      ).rows[0].participation_stopped,
      true,
    );
    await assert.rejects(
      db.query("select sync_roster_participation($1,'[]',$2)", [
        admin,
        JSON.stringify([{ number: "30101", stopped: "FALSE" }]),
      ]),
      /중단 체크/,
    );
    await db.exec("set role anon");
    await assert.rejects(sync(true), /permission denied/);
  } finally {
    await db.close();
  }
});
