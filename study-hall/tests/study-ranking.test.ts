import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { demoStudyRanking, rankingTime } from "../src/study-ranking";

test("오늘·주간 순위: 공동 인원·1등 차이·자정·진행 중 제외·본인 보호", async () => {
  const db = new PGlite();
  const now = "2026-10-16T18:00:00+09:00";
  await db.exec(`create role anon;create role authenticated;create role service_role;
 create table admins(user_id uuid);create table students(id uuid primary key,name text,number text,active boolean,deleted_at timestamptz);
 create table student_codes(student_id uuid,version int);create table student_sessions(student_id uuid,token_hash text,version int,expires_at timestamptz);
 create table teacher_viewer_code(id boolean,version int);create table teacher_viewer_sessions(token_hash text,version int,expires_at timestamptz);
 create table visits(id uuid default gen_random_uuid(),student_id uuid,entered_at timestamptz,exited_at timestamptz);
 insert into teacher_viewer_code values(true,1);insert into teacher_viewer_sessions values('viewer',1,'2027-01-01'),('expired',1,'2026-10-01');`);
  const admin = randomUUID(),
    ids = Array.from({ length: 7 }, () => randomUUID());
  await db.query("insert into admins values($1)", [admin]);
  const students = ids.map((id, i) => ({
    id,
    name: "학생" + i,
    number: "3010" + i,
    active: i !== 5,
    deleted_at: i === 6 ? now : null,
    seat_id: null,
  }));
  for (const s of students)
    await db.query("insert into students values($1,$2,$3,$4,$5)", [
      s.id,
      s.name,
      s.number,
      s.active,
      s.deleted_at,
    ]);
  await db.query("insert into student_codes values($1,1)", [ids[1]]);
  await db.query(
    "insert into student_sessions values($1,'mine',1,'2027-01-01')",
    [ids[1]],
  );
  const visits: {
    id: string;
    student_id: string;
    entered_at: string;
    exited_at: string | null;
  }[] = [];
  const add = async (i: number, start: string, end: string | null) => {
    visits.push({
      id: randomUUID(),
      student_id: ids[i],
      entered_at: start,
      exited_at: end,
    });
    await db.query(
      "insert into visits(student_id,entered_at,exited_at) values($1,$2,$3)",
      [ids[i], start, end],
    );
  };
  await add(0, "2026-10-16T08:00:00+09:00", "2026-10-16T10:00:00+09:00");
  await add(0, "2026-10-15T08:00:00+09:00", "2026-10-15T09:00:00+09:00");
  for (const i of [1, 2])
    await add(i, "2026-10-16T08:00:00+09:00", "2026-10-16T09:00:00+09:00");
  await add(1, "2026-10-15T08:00:00+09:00", "2026-10-15T11:00:00+09:00");
  await add(2, "2026-10-15T08:00:00+09:00", "2026-10-15T09:00:00+09:00");
  await add(3, "2026-10-16T08:00:00+09:00", null);
  await add(4, "2026-10-15T23:30:00+09:00", "2026-10-16T00:30:00+09:00");
  await add(0, "2026-10-16T16:00:00+09:00", "2026-10-16T19:00:00+09:00");
  for (const i of [5, 6])
    await add(i, "2026-10-16T01:00:00+09:00", "2026-10-16T17:00:00+09:00");
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20261016124815_daily_weekly_study_ranking.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(migration.replaceAll("now()", `'${now}'::timestamptz`));
  const averageMigration = await readFile(
    new URL(
      "../supabase/migrations/20261016125742_ranking_average_time.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(averageMigration.replaceAll("now()", `'${now}'::timestamptz`));
  const previousMigration = await readFile(
    new URL(
      "../supabase/migrations/20261019074955_previous_week_ranking.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(previousMigration);
  await add(0, "2026-10-05T08:00:00+09:00", "2026-10-05T09:00:00+09:00");
  await add(1, "2026-10-09T08:00:00+09:00", "2026-10-09T10:00:00+09:00");
  await add(0, "2026-10-10T08:00:00+09:00", "2026-10-10T18:00:00+09:00");
  const read = async (
    scope = "week",
    a: string | null = admin,
    viewer: string | null = null,
    mine: string | null = null,
  ) =>
    (
      await db.query<{ r: any }>("select study_ranking($1,$2,$3,$4) r", [
        scope,
        a,
        viewer,
        mine,
      ])
    ).rows[0].r;
  for (const scope of ["day", "week", "previous_week"] as const) {
    const r = await read(scope);
    assert.deepEqual(
      r,
      demoStudyRanking(students, visits, scope, Date.parse(now)),
    );
  }
  const previous = await read("previous_week");
  assert.equal(previous.period_start, "2026-10-05");
  assert.equal(previous.period_end, "2026-10-09");
  assert.equal(previous.participants, 2);
  assert.equal(previous.rows[0].id, ids[1]);
  assert.equal(previous.rows[0].seconds, 7200);
  const ownPrevious = await read("previous_week", null, null, "mine");
  assert.equal(ownPrevious.mine.rank, 1);
  assert.equal(ownPrevious.rows, undefined);
  assert.ok(!JSON.stringify(ownPrevious).includes(ids[0]));
  let r = await read("day", null, null, "mine");
  assert.equal(r.rows, undefined);
  assert.equal(r.mine.rank, 2);
  assert.equal(r.mine.tied_count, 2);
  assert.equal(r.mine.leader_gap_seconds, 3600);
  assert.equal(r.mine.seconds, 3600);
  assert.equal(r.average_seconds, 4050);
  assert.ok(!JSON.stringify(r).includes(ids[0]));
  assert.ok(!JSON.stringify(r).includes("학생0"));
  r = await read("week", null, null, "mine");
  assert.equal(r.mine.rank, 1);
  assert.equal(r.average_seconds, 9000);
  assert.equal(r.mine.leader_gap_seconds, 0);
  assert.equal(r.mine.tied_count, 1);
  assert.deepEqual(await read("day", null, "viewer"), await read("day"));
  await assert.rejects(read("day", null), /로그인/);
  await assert.rejects(read("day", null, "expired"), /로그인/);
  await assert.rejects(read("month"), /기간/);
  const empty = (await read("day")).rows.find((r: any) => r.id === ids[3]);
  assert.equal(empty.rank, null);
  assert.equal(empty.tied_count, 0);
  assert.equal(empty.leader_gap_seconds, null);
  await db.exec("set role anon");
  await assert.rejects(db.query("select study_ranking('day')"), /permission/);
  await db.exec("reset role");
  await add(0, "2026-10-17T08:00:00+09:00", "2026-10-17T09:00:00+09:00");
  await db.exec(
    averageMigration
      .replace("create function", "create or replace function")
      .replaceAll("now()", "'2026-10-17T18:00:00+09:00'::timestamptz"),
  );
  assert.equal(
    (await read("day")).rows.find((r: any) => r.id === ids[0]).seconds,
    3600,
  );
  assert.equal(
    (await read("week")).rows.find((r: any) => r.id === ids[0]).seconds,
    21600,
  );
  await db.exec(
    averageMigration.replaceAll(
      "now()",
      "'2026-10-19T18:00:00+09:00'::timestamptz",
    ),
  );
  await db.exec(previousMigration);
  assert.equal((await read("previous_week")).period_start, "2026-10-12");
  await db.exec("truncate visits");
  r = await read("day", null, null, "mine");
  assert.equal(r.participants, 0);
  assert.equal(r.mine.rank, null);
  assert.equal(r.mine.tied_count, 0);
  assert.equal(r.mine.leader_gap_seconds, null);
  assert.equal(rankingTime(3601), "1시간 0분 1초");
  assert.equal(rankingTime(59), "59초");
  assert.equal(rankingTime(0), "0분");
  await db.close();
});
