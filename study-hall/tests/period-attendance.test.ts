import { missingAttendancePeriods } from "../supabase/functions/api/attendance-completion";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  periodsForDay,
  periodAt,
  defaultAttendance,
  attendancePreview,
  manualAttendancePreview,
} from "../src/period-attendance";
import {
  attendanceSheetRows,
  shouldSyncAttendance,
  handlePeriodAttendance,
} from "../supabase/functions/api/period-attendance";

test("자동 퇴실 후 직접 출석체크: 미확인 학생만 출석으로 시작하고 저장한 출결은 보존", () => {
  const entries = defaultAttendance(["a", "b"].map((id) => ({
    id, name: id, number: id, seat_id: null, active: true,
  })), []);
  entries[1] = { ...entries[1], confirmed: true, status: "excused", note: "병원", exempt_reason: "진료" };
  const next = manualAttendancePreview(entries);
  assert.equal(next[0].status, "present");
  assert.equal(next[0].confirmed, undefined);
  assert.deepEqual(next[1], entries[1]);
  assert.equal(entries[0].status, "absent");
});

test("구글 반영은 모든 교시 확인 완료 후: 마지막 교시 선확인·기존 반영·부분 확인·주말은 전송 보류", async () => {
  const all = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      period: i + 1,
      confirmed: true,
      synced_revision: 0,
      entries: [],
    }));
  assert.equal(shouldSyncAttendance("2026-10-19", all(7)), true);
  assert.equal(shouldSyncAttendance("2026-10-21", all(6)), true);
  assert.equal(shouldSyncAttendance("2026-10-16", all(6)), true);
  assert.equal(
    shouldSyncAttendance("2026-10-19", [{ period: 7, confirmed: true }]),
    false,
  );
  assert.equal(shouldSyncAttendance("2026-10-19", all(6)), false);
  assert.equal(
    shouldSyncAttendance("2026-10-16", [
      { period: 1, confirmed: true, synced_revision: 1 },
    ]),
    false,
  );
  assert.equal(shouldSyncAttendance("2026-10-17", all(7)), false);
  assert.equal(shouldSyncAttendance("invalid", []), false);
  assert.equal(
    shouldSyncAttendance(
      "2026-10-19",
      all(7).map((s) =>
        s.period === 4 ? { ...s, confirmed: false, synced_revision: 1 } : s,
      ),
    ),
    false,
  );
  assert.deepEqual(
    missingAttendancePeriods(
      "2026-10-19",
      [1, 2, 6].map((period) => ({ period, confirmed: true })),
    ),
    [3, 4, 5, 7],
  );
  assert.deepEqual(missingAttendancePeriods("2026-10-21", all(6)), []);
  const operations: string[] = [],
    network: string[] = [];
  let sessions: any[] = all(7).filter((s) => s.period !== 2);
  let sourceChanged = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, options) => {
    const outer = JSON.parse(String(options?.body)),
      inner = JSON.parse(outer.payload);
    network.push(inner.action);
    return Response.json({
      ok: true,
      ready: true,
      attendance: true,
      updated: 1,
      url: "https://docs.google.com/spreadsheets/d/test",
    });
  };
  const db = {
    rpc: async (_name: string, args: any) => {
      operations.push(args.p_action);
      return {
        data:
          args.p_action === "sync_payload"
            ? {
                day: "2026-10-19",
                sessions: sourceChanged ? sessions.slice(0, 6) : sessions,
                endpoint: "https://script.google.com/macros/s/test/exec",
                secret: "test-secret",
                spreadsheet_id: "test",
                generation: 10,
              }
            : { day: "2026-10-19", sessions },
        error: null,
      };
    },
  };
  try {
    for (const action of [
      "period_attendance_save",
      "period_attendance_reset",
      "period_attendance_sync",
    ]) {
      operations.length = 0;
      const r = await handlePeriodAttendance(
        db,
        action,
        { day: "2026-10-19", period: 7 },
        "admin",
        null,
      );
      assert.equal(r.sheet_deferred, true);
      assert.deepEqual(network, []);
      assert.deepEqual(operations, [
        action === "period_attendance_save"
          ? "save"
          : action === "period_attendance_reset"
            ? "reset"
            : "read",
      ]);
    }
    sessions = all(7);
    sourceChanged = true;
    operations.length = 0;
    const stale = await handlePeriodAttendance(
      db,
      "period_attendance_save",
      { day: "2026-10-19", period: 2 },
      "admin",
      null,
    );
    assert.equal(stale.sheet_deferred, true);
    assert.deepEqual(network, []);
    assert.deepEqual(operations, ["save", "sync_payload", "read"]);
    sourceChanged = false;
    operations.length = 0;
    const done = await handlePeriodAttendance(
      db,
      "period_attendance_save",
      { day: "2026-10-19", period: 2 },
      "admin",
      null,
    );
    assert.equal(done.sheet_sync.ok, true);
    assert.deepEqual(network, ["check", "attendance"]);
    assert.deepEqual(operations, [
      "save",
      "sync_payload",
      "mark_synced",
      "read",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("시간표: 월화 7교시·수목금 6교시, 시작·종료·쉬는시간·점심·주말", () => {
  assert.equal(periodsForDay("2026-10-19"), 7);
  assert.equal(periodsForDay("2026-10-20"), 7);
  assert.equal(
    periodsForDay("2026-10-20", { end_time: "17:00", is_closed: true }),
    0,
  );
  assert.equal(periodsForDay("2026-10-20", { end_time: "08:00" }), 0);
  assert.equal(periodsForDay("2026-10-20", { end_time: "09:50" }), 1);
  assert.equal(periodsForDay("2026-10-20", { end_time: "13:00" }), 4);
  assert.equal(
    periodsForDay("2026-10-20", { end_time: "17:00", student_ids: [] }),
    0,
  );
  assert.equal(
    shouldSyncAttendance("2026-10-20", [], { end_time: "08:00" }),
    false,
  );
  assert.equal(
    shouldSyncAttendance(
      "2026-10-20",
      [1, 2, 3, 4].map((period) => ({ period, confirmed: true })),
      { end_time: "13:00" },
    ),
    true,
  );
  assert.equal(periodsForDay("2026-10-21"), 6);
  assert.equal(periodsForDay("2026-10-17"), 0);
  const at = (s: string) => periodAt(Date.parse(`2026-10-19T${s}:00+09:00`));
  assert.deepEqual(at("08:49"), { period: 1, label: "수업 시작 전" });
  assert.deepEqual(at("08:50"), { period: 1, label: "수업 중" });
  assert.deepEqual(at("09:40"), { period: 1, label: "쉬는 시간" });
  assert.deepEqual(at("09:50"), { period: 2, label: "수업 중" });
  assert.deepEqual(at("12:40"), { period: 4, label: "점심시간" });
  assert.deepEqual(at("13:40"), { period: 5, label: "수업 중" });
  assert.deepEqual(at("16:30"), { period: 7, label: "오늘 수업 종료" });
  assert.deepEqual(periodAt(Date.parse("2026-10-16T15:40:00+09:00")), {
    period: 6,
    label: "오늘 수업 종료",
  });
});
test("시트에는 확인 완료한 교시만 표시·미확인 공란·금요일 7교시 해당 없음", () => {
  const rows = attendanceSheetRows({
    day: "2026-10-16",
    sessions: [
      {
        period: 1,
        confirmed: true,
        entries: [
          {
            student_id: "a",
            name: "가상",
            number: "30101",
            status: "late",
            note: "늦게 도착",
          },
        ],
      },
      {
        period: 2,
        confirmed: false,
        entries: [
          { student_id: "a", name: "가상", number: "30101", status: "absent" },
        ],
      },
    ],
  });
  assert.deepEqual(rows, [
    {
      name: "가상",
      number: "30101",
      statuses: ["지각", "", "", "", "", "", "—"],
      note: "1교시: 늦게 도착",
    },
  ]);
});
test("기본 출석은 이용가능 학생만, 미배정도 포함", () => {
  const rows = defaultAttendance([
    { id: "a", name: "가상", number: "2", seat_id: null, active: true },
    { id: "b", name: "중지", number: "1", seat_id: 1, active: false },
    {
      id: "c",
      name: "삭제",
      number: "3",
      seat_id: 2,
      active: true,
      deleted_at: "2026-10-16",
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "present");
  assert.equal(rows[0].seat_id, null);
});

test("확인 전 표시는 현재 입실만 출석, 퇴실·미입실은 결석이며 원본은 유지", () => {
  const students = ["a", "b", "c"].map((id, i) => ({
    id,
    name: id,
    number: String(i + 1),
    seat_id: i + 1,
    active: true,
  }));
  const visits = [
    {
      id: "1",
      student_id: "a",
      entered_at: "2026-10-19T08:00:00+09:00",
      exited_at: null,
    },
    {
      id: "2",
      student_id: "b",
      entered_at: "2026-10-19T08:00:00+09:00",
      exited_at: "2026-10-19T09:00:00+09:00",
    },
  ];
  assert.deepEqual(
    defaultAttendance(students, visits).map((e) => e.status),
    ["present", "absent", "absent"],
  );
  const saved = defaultAttendance(students).map((e) => ({
    ...e,
    status: "late" as const,
    note: "유지할 기록",
  }));
  assert.deepEqual(
    attendancePreview(saved, visits).map((e) => e.status),
    ["present", "absent", "absent"],
  );
  assert.ok(
    saved.every((e) => e.status === "late" && e.note === "유지할 기록"),
  );
  assert.ok(attendancePreview(saved).every((e) => e.status === "present")); // Historical preview does not use today's presence.
});

test("교시별 DB: 역할·전체 저장·수정 이력·동시수정·초기화·시트 버전·RLS", async (t) => {
  const db = new PGlite();
  await db.exec(`create schema vault;create role anon;create role authenticated;create role service_role bypassrls;
 create table public.admins(user_id uuid primary key);
 create table public.students(id uuid primary key,name text,number text,seat_id int,active boolean,deleted_at timestamptz);
 create table public.teacher_viewer_code(id boolean primary key,version int);
 create table public.teacher_viewer_sessions(token_hash text primary key,version int,expires_at timestamptz);
 create table public.seat_sheet_sync_config(id boolean primary key,endpoint text,secret_id uuid,spreadsheet_id text);
 create table vault.decrypted_secrets(id uuid,decrypted_secret text);
 create table public.role_menu_order(id boolean primary key,orders jsonb,revision int);
 create function public.menu_order_api(text,jsonb,uuid,text,text) returns jsonb language sql as 'select ''{}''::jsonb';
 insert into public.teacher_viewer_code values(true,1);
 insert into public.teacher_viewer_sessions values('teacher-valid',1,now()+interval '1 day');
 insert into public.teacher_viewer_sessions values('teacher-expired',1,now()-interval '1 day');`);
  try {
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261016055601_period_attendance.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
  } catch (error) {
    const e = error as any;
    console.error({
      position: e.position,
      internalPosition: e.internalPosition,
      internalQuery: e.internalQuery,
      where: e.where,
    });
    throw error;
  }
  const admin = randomUUID(),
    a = randomUUID(),
    b = randomUUID();
  await db.query("insert into public.admins values($1)", [admin]);
  await db.query(
    "insert into public.students values($1,'가상 A','30101',1,true,null),($2,'가상 B','30102',null,true,null)",
    [a, b],
  );
  const day = (
    await db.query<{ day: string }>(
      "select to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD') as day",
    )
  ).rows[0].day;
  const weekday = new Date(day + "T12:00:00+09:00").getUTCDay();
  const today = weekday > 0 && weekday < 6 ? day : "2026-10-16";
  const entries = [
    { student_id: a, status: "present", note: "" },
    { student_id: b, status: "absent", note: "아직 미도착" },
  ];
  const call = async (
    action: string,
    p: any = {},
    who: string | null = admin,
    viewer: string | null = null,
  ) =>
    (
      await db.query<{ value: any }>(
        "select public.period_attendance_api($1,$2::jsonb,$3::uuid,$4) as value",
        [action, JSON.stringify({ day: today, ...p }), who, viewer],
      )
    ).rows[0].value;
  await t.test("무권한·만료·학생·위조 관리자 거부", async () => {
    await assert.rejects(call("read", {}, null, null), /권한/);
    await assert.rejects(call("read", {}, null, "teacher-expired"), /권한/);
    await assert.rejects(call("read", {}, randomUUID()), /권한/);
  });
  const request_id = randomUUID();
  let read = await call("save", {
    period: 1,
    revision: 0,
    request_id,
    entries,
  });
  assert.equal(read.sessions[0].entries.length, 2);
  assert.equal(read.sessions[0].entries[1].name, "가상 B");
  assert.equal(read.sessions[0].synced_revision, 0);
  assert.equal(read.history.length, 1);
  await t.test("같은 요청 재시도 중복 방지·학생목록·상태 검사", async () => {
    assert.equal(
      (await call("save", { period: 1, revision: 0, request_id, entries }))
        .sessions[0].revision,
      1,
    );
    await assert.rejects(
      call("save", {
        period: 1,
        revision: 0,
        request_id: randomUUID(),
        entries,
      }),
      /다른 교사/,
    );
    await assert.rejects(
      call("save", {
        period: 2,
        revision: 0,
        request_id: randomUUID(),
        entries: [entries[0]],
      }),
      /대상 학생/,
    );
    await assert.rejects(
      call("save", {
        period: 2,
        revision: 0,
        request_id: randomUUID(),
        entries: [entries[0], entries[0]],
      }),
      /중복/,
    );
    await assert.rejects(
      call("save", {
        period: 2,
        revision: 0,
        request_id: randomUUID(),
        entries: [entries[0], { ...entries[1], status: "invalid" }],
      }),
      /상태/,
    );
    await assert.rejects(
      call("save", {
        day: "2026-10-16",
        period: 7,
        revision: 0,
        request_id: randomUUID(),
        entries,
      }),
      /없는 교시/,
    );
    await assert.rejects(
      call("save", {
        day: "2026-10-17",
        period: 1,
        revision: 0,
        request_id: randomUUID(),
        entries,
      }),
      /없는 교시/,
    );
  });
  entries[1].status = "late";
  read = await call("save", {
    period: 1,
    revision: 1,
    request_id: randomUUID(),
    entries,
  });
  assert.equal(read.history[0].changes[0].before, "absent");
  assert.equal(read.history[0].changes[0].after, "late");
  await t.test(
    "역사적 이름·좌석 보존 및 교사 과거 수정·초기화 금지",
    async () => {
      await db.query(
        "update public.students set name='수정이름',seat_id=5 where id=$1",
        [a],
      );
      read = await call("save", {
        period: 1,
        revision: 2,
        request_id: randomUUID(),
        entries,
      });
      assert.equal(read.sessions[0].entries[0].name, "가상 A");
      assert.equal(read.sessions[0].entries[0].seat_id, 1);
      assert.equal(
        (await call("read", {}, null, "teacher-valid")).history.length,
        0,
      );
      await assert.rejects(
        call(
          "save",
          {
            day: "2026-01-05",
            period: 1,
            revision: 0,
            request_id: randomUUID(),
            entries,
          },
          null,
          "teacher-valid",
        ),
        /관리자/,
      );
      await assert.rejects(
        call(
          "reset",
          {
            period: 1,
            revision: 3,
            request_id: randomUUID(),
            reason: "재확인",
          },
          null,
          "teacher-valid",
        ),
        /관리자/,
      );
    },
  );
  await t.test("관리자 초기화 이력 보존 및 이후 재확인", async () => {
    read = await call("reset", {
      period: 1,
      revision: 3,
      request_id: randomUUID(),
      reason: "명단 재확인",
    });
    assert.equal(read.sessions[0].confirmed, false);
    assert.equal(read.sessions[0].revision, 4);
    assert.equal(read.history[0].action, "reset");
    read = await call("save", {
      period: 1,
      revision: 4,
      request_id: randomUUID(),
      entries,
    });
    assert.equal(read.sessions[0].confirmed, true);
  });
  await t.test("오래된 시트 동기화 확인은 거부", async () => {
    const generation = read.sessions[0].change_id;
    await assert.rejects(
      call("mark_synced", { generation: generation - 1 }),
      /재반영/,
    );
    await call("mark_synced", { generation });
    assert.equal((await call("read")).sessions[0].synced_revision, 5);
  });
  await db.exec("set role anon;");
  await assert.rejects(
    db.query("select * from public.period_attendance_sessions"),
    /permission denied/,
  );
  await assert.rejects(
    db.query("select public.period_attendance_api('read','{}')"),
    /permission denied/,
  );
  await db.exec("reset role;");
  await db.close();
});


test("교사 저장은 모든 교시 완료여도 구글을 호출하지 않고, 시트 요청은 차단", async () => {
 const operations:string[]=[];
 const saved={sessions:Array.from({length:7},(_,i)=>({period:i+1,confirmed:true}))};
 const db={rpc:async (_name:string,args:any)=>{operations.push(args.p_action);return {data:saved,error:null}}};
 for(const action of ["period_attendance_save","period_attendance_bulk"]){
  operations.length=0;
  assert.deepEqual(await handlePeriodAttendance(db,action,{day:"2026-10-19"},null,"teacher"),saved);
  assert.equal(operations.length,1);
 }
 for(const action of ["period_attendance_sync","period_attendance_connection"])
  await assert.rejects(handlePeriodAttendance(db,action,{day:"2026-10-19"},null,"teacher"),/관리자/);
});
