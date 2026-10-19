import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { attendancePreview } from "../src/period-attendance";
import { demoCollections } from "../src/study-ranking";
import {
  attendanceSheetRows,
  handlePeriodAttendance,
  shouldSyncAttendance,
} from "../supabase/functions/api/period-attendance";
test("학생별 여러 교시 저장·재수정: 다른 학생 보존·부분 확인·충돌 원자성·재시도·권한·출결/클로버 연계", async () => {
  const db = new PGlite(),
    now = "2026-10-19T10:00:00+09:00",
    admin = randomUUID(),
    ids = Array.from({ length: 3 }, () => randomUUID());
  const migration = async (name: string) =>
    readFile(
      new URL("../supabase/migrations/" + name, import.meta.url),
      "utf8",
    );
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema vault;
 create table admins(user_id uuid);create table students(id uuid primary key,name text,number text,seat_id int,active boolean,deleted_at timestamptz);
 create table teacher_viewer_code(id boolean,version int);create table teacher_viewer_sessions(token_hash text,version int,expires_at timestamptz);
 create table seat_sheet_sync_config(id boolean,endpoint text,secret_id uuid,spreadsheet_id text);create table vault.decrypted_secrets(id uuid,decrypted_secret text);
 create table role_menu_order(id boolean,orders jsonb,revision int);create function menu_order_api(text,jsonb,uuid,text,text) returns jsonb language sql as 'select ''{}''::jsonb';
 create table student_codes(student_id uuid,version int);create table student_sessions(student_id uuid,token_hash text,version int,expires_at timestamptz);
 create table visits(id uuid primary key default gen_random_uuid(),student_id uuid references students(id),entered_at timestamptz,exited_at timestamptz);
 insert into teacher_viewer_code values(true,1);insert into teacher_viewer_sessions values('teacher-valid',1,'2027-01-01'),('expired',1,'2026-01-01');`);
    await db.query("insert into admins values($1)", [admin]);
    for (const [i, id] of ids.entries())
      await db.query("insert into students values($1,$2,$3,$4,true,null)", [
        id,
        "학생" + i,
        "3010" + i,
        i + 1,
      ]);
    for (const name of [
      "20261016055601_period_attendance.sql",
      "20261016083447_daily_attendance_summary.sql",
      "20261016090925_period_attendance_checkin.sql",
    ])
      await db.exec(
        (await migration(name)).replaceAll("now()", `'${now}'::timestamptz`),
      );
    const clover = (
      await migration("20261016134818_full_day_attendance_clovers.sql")
    ).split("create or replace function public.study_collections")[0];
    await db.exec(clover.replaceAll("now()", `'${now}'::timestamptz`));
    await db.exec(
      (
        await migration("20261018233858_student_period_bulk_edit.sql")
      ).replaceAll("now()", `'${now}'::timestamptz`),
    );
    await db.exec(
      (
        await migration("20261019000000_selectable_attendance_periods.sql")
      ).replaceAll("now()", `'${now}'::timestamptz`),
    );
    await db.exec(
      (await migration("20261019045714_daily_attendance_rules.sql")).replaceAll(
        "now()",
        `'${now}'::timestamptz`,
      ),
    );
    await db.query(
      "insert into visits(student_id,entered_at) values($1,'2026-10-19T08:10:00+09:00')",
      [ids[1]],
    );
    const read = async (day = "2026-10-19") =>
      (
        await db.query<{ r: any }>(
          "select period_attendance_api('read',$1,null,'teacher-valid') r",
          [JSON.stringify({ day })],
        )
      ).rows[0].r;
    const bulk = async (
      p: any,
      who: string | null = null,
      viewer: string | null = "teacher-valid",
    ) =>
      (
        await db.query<{ r: any }>(
          "select period_attendance_bulk($1,$2,$3) r",
          [JSON.stringify(p), who, viewer],
        )
      ).rows[0].r;
    const arbitrary = {
      day: "2026-10-19",
      student_id: ids[0],
      periods: [2, 4, 6],
      status: "excused",
      note: "선택 교시만 변경",
      request_id: randomUUID(),
      revisions: { 2: 0, 4: 0, 6: 0 },
    };
    const picked = await bulk(arbitrary);
    assert.deepEqual(
      picked.sessions.map((s: any) => s.period).sort(),
      [2, 4, 6],
    );
    assert.equal(
      picked.sessions.every(
        (s: any) =>
          s.entries.find((e: any) => e.student_id === ids[0]).note ===
          arbitrary.note,
      ),
      true,
    );
    const revised = await bulk({
      ...arbitrary,
      note: "선택 교시 재수정",
      request_id: randomUUID(),
      revisions: { 2: 1, 4: 1, 6: 1 },
    });
    assert.deepEqual(
      revised.sessions.map((s: any) => s.period).sort(),
      [2, 4, 6],
    );
    for (const periods of [[], [2, 2], [8], [2.5], ["2"], null])
      await assert.rejects(
        bulk({ ...arbitrary, periods, request_id: randomUUID() }),
      );
    const exempted = await bulk({
      ...arbitrary,
      exempt_reason: "면접고사",
      request_id: randomUUID(),
      revisions: { 2: 2, 4: 2, 6: 2 },
    });
    assert.ok(
      exempted.sessions.every(
        (s: any) =>
          s.entries.find((e: any) => e.student_id === ids[0]).exempt_reason ===
          "면접고사",
      ),
    );
    const cleared = await bulk({
      ...arbitrary,
      status: "late",
      exempt_reason: "면접고사",
      request_id: randomUUID(),
      revisions: { 2: 3, 4: 3, 6: 3 },
    });
    assert.ok(
      cleared.sessions.every(
        (s: any) =>
          s.entries.find((e: any) => e.student_id === ids[0]).exempt_reason ===
          "",
      ),
    );
    const source = (
      await db.query<{ r: any }>(
        "select attendance_daily_source($1,null,'teacher-valid',null) r",
        [{ start: "2026-10-01", end: "2026-10-31" }],
      )
    ).rows[0].r;
    assert.equal(source.daily_source.length, 1);
    assert.ok(source.daily_source.every((d: any) => d.entries.length === 3));
    await assert.rejects(
      db.query("select attendance_daily_source($1,null,null,null)", [
        { start: "2026-10-01", end: "2026-10-31" },
      ]),
      /로그인/,
    );
    await db.query("insert into student_codes values($1,1);", [ids[0]]);
    await db.query(
      "insert into student_sessions values($1,'own-valid',1,'2027-01-01');",
      [ids[0]],
    );
    const ownSource = (
      await db.query<{ r: any }>(
        "select attendance_daily_source($1,null,null,'own-valid') r",
        [{ start: "2026-10-01", end: "2026-10-31" }],
      )
    ).rows[0].r;
    assert.equal(ownSource.selected, ids[0]);
    assert.ok(
      ownSource.daily_source.every((d: any) => d.student_id === ids[0]),
    );
    await assert.rejects(
      db.query("select attendance_daily_source($1,null,null,'own-valid')", [
        { start: "2026-10-01", end: "2026-10-31", student_id: ids[1] },
      ]),
      /본인/,
    );
    await assert.rejects(
      db.query("select attendance_daily_source($1,null,null,'expired')", [
        { start: "2026-10-01", end: "2026-10-31" },
      ]),
      /만료/,
    );
    await db.query(
      "delete from period_attendance_checkins where student_id=$1",
      [ids[0]],
    );
    await db.query("delete from visits where student_id=$1", [ids[0]]);
    await db.exec(
      "truncate period_attendance_sessions,period_attendance_events,period_attendance_bulk_requests",
    );
    const make = (status = "excused", note = "병원 진료") => ({
      day: "2026-10-19",
      student_id: ids[0],
      start_period: 2,
      end_period: 4,
      status,
      note,
      request_id: randomUUID(),
      revisions: { 2: 0, 3: 0, 4: 0 } as Record<string, number>,
    });
    const payload = make();
    let result = await bulk(payload);
    assert.equal(result.sessions.length, 3);
    for (const s of result.sessions) {
      assert.equal(s.confirmed, false);
      assert.equal(s.revision, 1);
      assert.equal(s.entries[0].status, "excused");
      assert.equal(s.entries[0].confirmed, true);
      assert.equal(s.entries[1].status, "present");
      assert.equal(s.entries[1].confirmed, undefined);
      assert.equal(attendancePreview(s.entries, [])[0].note, "병원 진료");
    }
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from visits"))
        .rows[0].n,
      1,
    );
    const summary = async () =>
      (
        await db.query<{ r: any }>(
          "select attendance_summary($1,$2,null,null) r",
          [
            JSON.stringify({
              student_id: ids[0],
              start: "2026-10-19",
              end: "2026-10-19",
            }),
            admin,
          ],
        )
      ).rows[0].r;
    assert.equal((await summary()).summaries[0].excused, 3);
    assert.equal((await summary()).records.length, 3);
    const sheet = attendanceSheetRows(result);
    assert.equal(sheet.length, 1);
    assert.deepEqual(sheet[0].statuses.slice(1, 4), [
      "인정결석",
      "인정결석",
      "인정결석",
    ]);
    assert.equal(shouldSyncAttendance(result.day, result.sessions), false);
    assert.deepEqual(await bulk(payload), result);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from period_attendance_events",
        )
      ).rows[0].n,
      3,
    );
    await assert.rejects(bulk({ ...payload, note: "다른 내용" }), /중복/);
    const edit = {
      ...make("late", "늦게 도착"),
      revisions: { 2: 1, 3: 1, 4: 1 },
    };
    result = await bulk(edit);
    assert.equal((await summary()).summaries[0].late, 3);
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from visits"))
        .rows[0].n,
      2,
    );
    const first = (
      await db.query<{ t: string }>(
        "select entered_at::text t from visits where student_id=$1",
        [ids[0]],
      )
    ).rows[0].t;
    assert.equal(Date.parse(first), Date.parse(now));
    const old = result.sessions.find((s: any) => s.period === 3);
    const entries = old.entries.map((e: any) => ({
      ...e,
      status: e.student_id === ids[1] ? "absent" : e.status,
      note: e.student_id === ids[1] ? "타 학생 사유" : e.note,
    }));
    await assert.rejects(
      db.query("select period_attendance_api('save',$1,$2,null)", [
        JSON.stringify({
          day: payload.day,
          period: 3,
          entries,
          revision: 2,
          request_id: randomUUID(),
        }),
        admin,
      ]),
      /새로고침/,
    );
    await db.query("select period_attendance_api('save',$1,$2,null)", [
      JSON.stringify({
        day: payload.day,
        period: 3,
        entries,
        revision: 2,
        supports_individual_records: true,
        request_id: randomUUID(),
      }),
      admin,
    ]);
    result = await bulk({ ...make(), revisions: { 2: 2, 3: 3, 4: 2 } });
    const third = result.sessions.find((s: any) => s.period === 3);
    assert.equal(third.confirmed, true);
    assert.equal(third.entries[1].status, "absent");
    assert.equal(third.entries[1].note, "타 학생 사유");
    assert.equal(
      result.sessions.find((s: any) => s.period === 2).confirmed,
      false,
    );
    const before = JSON.stringify(result);
    await assert.rejects(
      bulk({ ...make(), revisions: { 2: 3, 3: 4, 4: 999 } }),
      /다른 교사/,
    );
    assert.equal(JSON.stringify(await read()), before);
    await assert.rejects(
      bulk({ ...make(), start_period: 4, end_period: 2 }),
      /범위/,
    );
    await assert.rejects(bulk({ ...make(), end_period: 8 }), /범위/);
    await assert.rejects(bulk({ ...make(), note: "" }), /사유/);
    await assert.rejects(bulk(make(), null, "expired"), /권한/);
    await assert.rejects(bulk(make(), null, null), /권한/);
    await assert.rejects(bulk({ ...make(), day: "2026-10-16" }), /관리자/);
    assert.equal(
      (await bulk({ ...make(), day: "2026-10-16" }, admin, null)).sessions
        .length,
      3,
    );
    await db.query("select period_attendance_api('reset',$1,$2,null)", [
      JSON.stringify({
        day: payload.day,
        period: 3,
        revision: 4,
        request_id: randomUUID(),
        reason: "초기화 검증",
      }),
      admin,
    ]);
    assert.ok(
      (await read()).sessions
        .find((s: any) => s.period === 3)
        .entries.every((e: any) => e.confirmed === undefined),
    );
    assert.equal((await summary()).summaries[0].excused, 2);
    result = await read();
    const revisions = Object.fromEntries(
      Array.from({ length: 7 }, (_, i) => [
        i + 1,
        result.sessions.find((s: any) => s.period === i + 1)?.revision ?? 0,
      ]),
    );
    result = await bulk({
      ...make("present", "전체 교시 출석 확인"),
      student_id: ids[2],
      start_period: 1,
      end_period: 7,
      revisions,
    });
    const days = (
      await db.query<{ student_id: string }>(
        "select * from full_attendance_days()",
      )
    ).rows;
    const demo = demoCollections(
      ids.map((id, i) => ({
        id,
        name: "학생" + i,
        number: String(i),
        active: true,
        seat_id: i + 1,
      })),
      [],
      Date.parse(now),
      result.sessions,
    );
    assert.equal(demo[ids[2]].clovers, 1);
    assert.equal(demo[ids[0]].clovers, 0);
    assert.deepEqual(
      days.map((d) => d.student_id),
      [ids[2]],
    );
    assert.equal(shouldSyncAttendance(result.day, result.sessions), false);
    assert.equal(
      (await db.query<{ n: number }>("select count(*)::int n from visits"))
        .rows[0].n,
      3,
    );
    const historic = "2026-10-16";
    const historicPayload = {
      ...make(),
      day: historic,
      periods: [1],
      exempt_reason: "면접고사",
      revisions: { 1: 0 },
    };
    const h = await bulk(historicPayload, admin, null);
    const saved = await db.query<{ r: any }>(
      "select period_attendance_api('save',$1,$2,null) r",
      [
        {
          day: historic,
          period: 1,
          revision: 1,
          request_id: randomUUID(),
          supports_individual_records: true,
          entries: h.sessions[0].entries.map((e: any) => ({
            student_id: e.student_id,
            status: e.status,
            note: e.note,
          })),
        },
        admin,
      ],
    );
    assert.equal(
      saved.rows[0].r.sessions[0].entries.find(
        (e: any) => e.student_id === ids[0],
      ).exempt_reason,
      "면접고사",
    );
    const updated = await db.query<{ r: any }>(
      "select period_attendance_api('save',$1,$2,null) r",
      [
        {
          day: historic,
          period: 1,
          revision: 2,
          request_id: randomUUID(),
          supports_individual_records: true,
          entries: saved.rows[0].r.sessions[0].entries.map((e: any) => ({
            ...e,
            exempt_reason: "",
          })),
        },
        admin,
      ],
    );
    assert.equal(
      updated.rows[0].r.sessions[0].entries.find(
        (e: any) => e.student_id === ids[0],
      ).exempt_reason,
      "",
    );
    await db.exec("set role anon");
    await assert.rejects(
      db.query("select period_attendance_bulk('{}')"),
      /permission/,
    );
    await assert.rejects(
      db.query("select attendance_daily_source('{}')"),
      /permission/,
    );
    await assert.rejects(
      db.query("select * from period_attendance_bulk_requests"),
      /permission/,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
test("여러 교시 변경은 RPC 한 번으로 저장하고 마지막 전체 확인 전에는 구글 호출하지 않음", async () => {
  const calls: any[] = [];
  const db = {
    rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      return {
        data: {
          day: "2026-10-19",
          sessions: [{ period: 4, confirmed: false, synced_revision: 0 }],
        },
        error: null,
      };
    },
  };
  const r = await handlePeriodAttendance(
    db,
    "period_attendance_bulk",
    { day: "2026-10-19" },
    null,
    "viewer",
  );
  assert.equal(r.sheet_deferred, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "period_attendance_bulk");
  assert.equal(calls[0].args.p_viewer_session, "viewer");
  assert.equal(calls[0].args.p_action, undefined);
});
