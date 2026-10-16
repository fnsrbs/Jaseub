import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("수동 처리: 교사·관리자만 허용, 사유·중복·이력·출석 자동 입실 보호", async () => {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;
 create table admins(user_id uuid primary key);
 create table teacher_viewer_code(id boolean primary key,version int);
 create table teacher_viewer_sessions(token_hash text primary key,version int,expires_at timestamptz);
 create table students(id uuid primary key,active boolean,deleted_at timestamptz);
 create table visits(id uuid primary key default gen_random_uuid(),student_id uuid references students(id),entered_at timestamptz not null default now(),exited_at timestamptz,check(exited_at is null or exited_at>=entered_at));
 create unique index one_open on visits(student_id) where exited_at is null;
 create table audits(actor uuid,kind text,before_value jsonb,after_value jsonb,reason text);
 create table period_attendance_sessions(day date,period int,entries jsonb,confirmed boolean,updated_by text,primary key(day,period));
 create table period_attendance_events(day date,created_at timestamptz,changes jsonb);
 insert into teacher_viewer_code values(true,1);
 insert into teacher_viewer_sessions values('valid',1,now()+interval '1 day'),('expired',1,now()-interval '1 day'),('revoked',2,now()+interval '1 day');`);
  for (const file of [
    "20261016090621_staff_manual_attendance.sql",
    "20261016090925_period_attendance_checkin.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  const admin = randomUUID(),
    student = randomUUID();
  await db.query("insert into admins values($1)", [admin]);
  await db.query("insert into students values($1,true,null)", [student]);
  const call = async (
    payload: any,
    viewer: string | null = "valid",
    a: string | null = null,
  ) =>
    (
      await db.query<{ r: any }>("select staff_manual_attendance($1,$2,$3) r", [
        payload,
        a,
        viewer,
      ])
    ).rows[0].r;
  const payload = {
    student_id: student,
    direction: "in",
    reason: "카메라 오류",
    request_id: randomUUID(),
  };
  for (const viewer of [null, "expired", "revoked"])
    await assert.rejects(call(payload, viewer), /권한/);
  await assert.rejects(call({ ...payload, reason: "" }), /사유/);
  const entered = await call(payload);
  assert.equal(entered.student_id, student);
  assert.equal(entered.exited_at, null);
  assert.equal((await call(payload)).id, entered.id);
  await assert.rejects(
    call({ ...payload, reason: "변경된 사유" }),
    /요청 번호/,
  );
  await assert.rejects(
    call({ ...payload, request_id: randomUUID() }),
    /이미 입실/,
  );
  const exited = await call({
    ...payload,
    direction: "out",
    request_id: randomUUID(),
  });
  assert.ok(exited.exited_at);
  const event = (
    await db.query<{ actor_role: string; reason: string }>(
      "select actor_role,reason from staff_manual_attendance_events order by id",
    )
  ).rows;
  assert.equal(event.length, 2);
  assert.equal(event[0].actor_role, "teacher");
  assert.equal(event[0].reason, payload.reason);
  await call({ ...payload, request_id: randomUUID() }, null, admin);
  assert.equal(
    (await db.query<{ n: number }>("select count(*)::int n from audits"))
      .rows[0].n,
    1,
  );
  await db.query("update students set active=false where id=$1", [student]);
  await call({ ...payload, direction: "out", request_id: randomUUID() });
  await assert.rejects(
    call({ ...payload, request_id: randomUUID() }),
    /이용 가능/,
  );
  await db.exec("set role anon");
  await assert.rejects(
    db.query("select staff_manual_attendance($1,null,$2)", [payload, "valid"]),
    /permission/,
  );
  await db.exec("reset role");

  const ids = Array.from({ length: 7 }, () => randomUUID());
  for (const id of ids)
    await db.query("insert into students values($1,true,null)", [id]);
  const day = (
    await db.query<{ day: string }>(
      "select to_char(now() at time zone 'Asia/Seoul','YYYY-MM-DD') as day",
    )
  ).rows[0].day;
  const qr = (
    await db.query<{ r: any }>(
      "insert into visits(student_id,entered_at) values($1,now()-interval '3 hours') returning to_jsonb(visits.*) r",
      [ids[4]],
    )
  ).rows[0].r;
  await db.query("update students set active=false where id=$1", [ids[5]]);
  const earlier = (
    await db.query<{ t: string }>("select (now()-interval '2 hours')::text t")
  ).rows[0].t;
  await db.query("insert into period_attendance_events values($1,$2,$3)", [
    day,
    earlier,
    JSON.stringify([{ student_id: ids[1], after: "late" }]),
  ]);
  const entries = ids
    .slice(0, 6)
    .map((student_id, i) => ({
      student_id,
      status: ["present", "late", "absent", "excused", "present", "present"][i],
    }));
  await db.query(
    "insert into period_attendance_sessions values($1,1,$2,true,'teacher:verified')",
    [day, JSON.stringify(entries)],
  );
  assert.equal(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from period_attendance_checkins",
      )
    ).rows[0].n,
    2,
  );
  const first = (
    await db.query<{ t: string }>(
      "select entered_at::text t from visits where student_id=$1",
      [ids[1]],
    )
  ).rows[0].t;
  assert.equal(new Date(first).getTime(), new Date(earlier).getTime());
  const unchanged = (
    await db.query<{ r: any }>(
      "select to_jsonb(visits.*) r from visits where id=$1",
      [qr.id],
    )
  ).rows[0].r;
  assert.equal(unchanged.entered_at, qr.entered_at);
  await db.query(
    "update period_attendance_sessions set entries=$1 where day=$2 and period=1",
    [JSON.stringify(entries), day],
  );
  assert.equal(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from period_attendance_checkins",
      )
    ).rows[0].n,
    2,
  );
  await db.query(
    "insert into period_attendance_sessions values(($1::date-1),1,$2,true,'admin:verified')",
    [day, JSON.stringify([{ student_id: ids[6], status: "present" }])],
  );
  assert.equal(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from visits where student_id=$1",
        [ids[6]],
      )
    ).rows[0].n,
    0,
  );
  await db.close();
});
