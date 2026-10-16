import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { demoCollections } from "../src/study-ranking";

test("일일 왕관·별, 하루 출석 클로버: 중복·공동순위·마감·수정·본인 보호", async () => {
  const db = new PGlite();
  try {
    const now = "2026-10-16T18:00:00+09:00",
      admin = randomUUID(),
      ids = Array.from({ length: 12 }, () => randomUUID());
    await db.exec(`create role anon;create role authenticated;create role service_role;
 create table admins(user_id uuid);create table students(id uuid primary key,name text,number text,active boolean,deleted_at timestamptz);
 create table student_codes(student_id uuid,version int);create table student_sessions(student_id uuid,token_hash text,version int,expires_at timestamptz);
 create table teacher_viewer_code(id boolean,version int);create table teacher_viewer_sessions(token_hash text,version int,expires_at timestamptz);
 create table visits(id uuid default gen_random_uuid(),student_id uuid,entered_at timestamptz,exited_at timestamptz);
 create table period_attendance_sessions(day date,confirmed boolean,entries jsonb);
 create function snapshot_with_warnings(p_admin uuid default null,p_session text default null,p_viewer_session text default null) returns jsonb language plpgsql as $$ declare result jsonb;begin
 if p_session is distinct from 'mine' then raise exception '로그인';end if;
 select jsonb_build_object('students',jsonb_build_array(jsonb_build_object('id',student_id))) into result from student_sessions where token_hash=p_session;
 return result || '{}'::jsonb;end $$;`);
    await db.query("insert into admins values($1)", [admin]);
    const students = ids.map((id, i) => ({
      id,
      name: "가상" + i,
      number: String(i),
      active: true,
      deleted_at: null,
      seat_id: null,
    }));
    for (const s of students)
      await db.query("insert into students values($1,$2,$3,true,null)", [
        s.id,
        s.name,
        s.number,
      ]);
    await db.query("insert into student_codes values($1,1);", [ids[2]]);
    await db.query(
      "insert into student_sessions values($1,'mine',1,'2027-01-01')",
      [ids[2]],
    );
    const visits: {
      id: string;
      student_id: string;
      entered_at: string;
      exited_at: string | null;
    }[] = [];
    async function add(i: number, day: string, seconds: number | null) {
      const start = day + "T08:00:00+09:00",
        end =
          seconds === null
            ? null
            : new Date(Date.parse(start) + seconds * 1000).toISOString();
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
    }
    for (const [i, seconds] of [
      7200, 7200, 3600, 3000, 2400, 1800, 1200, 600, 300,
    ].entries())
      await add(i, "2026-10-16", seconds);
    await add(2, "2026-10-16", 0); // Duplicate check-in on the same day.
    await add(2, "2026-10-15", 3600);
    const session = {
      day: "2026-10-16",
      confirmed: true,
      entries: [
        { student_id: ids[2], status: "late" },
        { student_id: ids[9], status: "present" },
        { student_id: ids[10], status: "absent" },
      ],
    } as any;
    await db.query(
      "insert into period_attendance_sessions values($1,true,$2)",
      [session.day, JSON.stringify(session.entries)],
    );
    await db.query(
      "insert into period_attendance_sessions values('2026-10-14',false,$1)",
      [JSON.stringify([{ student_id: ids[9], status: "present" }])],
    );
    const sql = await readFile(
      new URL(
        "../supabase/migrations/20261016131908_ranking_collections.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(sql.replaceAll("now()", `'${now}'::timestamptz`));
    const historySql = await readFile(
      new URL(
        "../supabase/migrations/20261016133112_collection_history.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(historySql.replaceAll("now()", `'${now}'::timestamptz`));
    const collections = async () =>
      (await db.query<{ r: any }>("select study_collections() r")).rows[0].r;
    let c = await collections();
    assert.deepEqual(
      c,
      demoCollections(students, visits, Date.parse(now), [session]),
    );
    assert.deepEqual(c[ids[0]], { crowns: 1, stars: 0, clovers: 1 });
    assert.deepEqual(c[ids[1]], { crowns: 1, stars: 0, clovers: 1 });
    assert.deepEqual(c[ids[2]], { crowns: 1, stars: 1, clovers: 2 });
    assert.equal(c[ids[5]].stars, 0); // Rank six does not earn a star or a rank clover.
    assert.deepEqual(c[ids[9]], { crowns: 0, stars: 0, clovers: 1 });
    assert.equal(c[ids[10]].clovers, 0);
    assert.deepEqual(c, await collections()); // Refreshes cannot duplicate awards.
    const history = async (
      kind: string,
      student: string | null = null,
      offset = 0,
      who: string | null = null,
      token: string | null = "mine",
    ) =>
      (
        await db.query<{ r: any }>(
          "select collection_history($1,$2,$3,$4,null,$5) r",
          [kind, student, offset, who, token],
        )
      ).rows[0].r;
    for (const kind of ["crowns", "stars", "clovers"] as const) {
      const h = await history(kind);
      assert.equal(h.total, c[ids[2]][kind]);
      assert.equal(h.records.length, h.total);
      assert.ok(!JSON.stringify(h).includes(ids[0]));
    }
    assert.deepEqual((await history("stars")).records, [
      { day: "2026-10-16", rank: 3, seconds: 3600 },
    ]);
    assert.deepEqual(
      (await history("clovers")).records.map((r: any) => r.day),
      ["2026-10-16", "2026-10-15"],
    );
    assert.equal((await history("crowns", ids[0], 0, admin, null)).total, 1);
    await assert.rejects(history("clovers", ids[0]), /본인/);
    await assert.rejects(history("clovers", null, 0, null, null), /로그인/);
    await assert.rejects(history("invalid"), /종류/);
    const read = async (scope: string) =>
      (
        await db.query<{ r: any }>(
          "select study_ranking($1,null,null,'mine') r",
          [scope],
        )
      ).rows[0].r;
    const own = await read("day");
    assert.deepEqual(own.mine.collection, c[ids[2]]);
    assert.equal(own.rows, undefined);
    assert.ok(!JSON.stringify(own).includes(ids[0]));
    assert.deepEqual((await read("week")).mine.collection, own.mine.collection);
    assert.equal(
      (
        await db.query<{ r: any }>(
          "select snapshot_with_warnings(null,'mine') r",
        )
      ).rows[0].r.clovers,
      2,
    );
    await assert.rejects(db.query("select study_ranking('day')"), /로그인/);
    await db.exec("set role anon");
    for (const fn of [
      "study_collections()",
      "study_clovers(null)",
      "study_ranking('day')",
      "study_collection_records()",
      "collection_history('clovers')",
    ])
      await assert.rejects(db.query("select " + fn), /permission/);
    await db.exec("reset role");
    await add(11, "2026-10-16", null); // Wait for all automatic checkouts before final daily awards.
    c = await collections();
    assert.equal(c[ids[0]].crowns, 0);
    assert.equal(c[ids[2]].crowns, 1);
    assert.equal(c[ids[11]].clovers, 1);
    await db.exec(
      "delete from visits where exited_at is null;update period_attendance_sessions set entries='[]'",
    );
    assert.equal((await collections())[ids[9]].clovers, 0); // Correcting attendance recalculates.
    await db.exec(
      sql
        .split("do $snapshot$")[0]
        .replaceAll("now()", "'2026-10-16T15:29:59+09:00'::timestamptz"),
    );
    assert.equal((await collections())[ids[0]].crowns, 0);
    assert.equal((await collections())[ids[2]].crowns, 1); // Previous-day awards remain.
    for (let i = 0; i < 60; i++)
      await db.query(
        "insert into visits(student_id,entered_at,exited_at) values($1,'2026-01-01'::timestamptz+($2||' days')::interval,null)",
        [ids[2], i],
      );
    const first = await history("clovers"),
      second = await history("clovers", null, 50);
    assert.equal(first.total, 62);
    assert.equal(first.records.length, 50);
    assert.equal(second.records.length, 12);
    assert.equal(
      new Set([...first.records, ...second.records].map((r: any) => r.day))
        .size,
      62,
    );
  } finally {
    await db.close();
  }
});
