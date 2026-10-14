import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
test("PostgreSQL: 마이그레이션·RLS·인증·QR·원자적 출결·좌석·수정 이력", async (t) => {
  const db = new PGlite();
  await db.exec(
    `create schema auth;create schema extensions;create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role bypassrls;grant usage on schema public to anon,authenticated,service_role;create function extensions.gen_random_uuid() returns uuid language sql as 'select gen_random_uuid()';`,
  );
  // PGlite has core gen_random_uuid but not the hosted pgcrypto extension loader.
  const sql = (
    await readFile(
      new URL(
        "../supabase/migrations/20261014142132_study_hall_initial.sql",
        import.meta.url,
      ),
      "utf8",
    )
  ).replace(
    "create extension if not exists pgcrypto with schema extensions;",
    "",
  );
  await db.exec(sql);
  const admin = randomUUID(),
    outsider = randomUUID(),
    a = randomUUID(),
    b = randomUUID();
  await db.query("insert into auth.users values($1),($2)", [admin, outsider]);
  await db.query("insert into admins values($1)", [admin]);
  await db.query(
    "insert into students(id,name,number,seat_id) values($1,'가상 A','A',1),($2,'가상 B','B',2)",
    [a, b],
  );
  const call = async (
    action: string,
    p: any = {},
    who: string | null = admin,
    session: string | null = null,
  ) => {
    const result = await db.query<{ value: any }>(
      "select app_api($1,$2::jsonb,$3::uuid,$4) as value",
      [action, JSON.stringify(p), who, session],
    );
    return result.rows[0].value;
  };
  await call("code", { student_id: a, code_hash: "hash-a" });
  await call("code", { student_id: b, code_hash: "hash-b" });
  await call("login", { code_hash: "hash-a", token_hash: "session-a" }, null);
  await call("login", { code_hash: "hash-b", token_hash: "session-b" }, null);
  await t.test("학생 간 데이터 접근 차단·건의 비공개", async () => {
    await call(
      "suggest",
      { title: "A 건의", body: "A 비공개" },
      null,
      "session-a",
    );
    await call(
      "suggest",
      { title: "B 건의", body: "B 비공개" },
      null,
      "session-b",
    );
    const result = await call("snapshot", {}, null, "session-a");
    assert.equal(result.students.length, 1);
    assert.equal(result.students[0].id, a);
    assert.equal(result.suggestions.length, 1);
    assert.equal(result.suggestions[0].student_id, a);
    assert.equal(result.audits.length, 0);
  });
  await t.test("관리자 권한 검증·학생 권한 상승 거부", async () => {
    await assert.rejects(call("snapshot", {}, outsider), /관리자 권한/);
    await assert.rejects(
      call("code", { student_id: b, code_hash: "stolen" }, null, "session-a"),
      /관리자 권한/,
    );
  });
  await t.test("RLS·테이블·RPC 직접 접근 차단", async () => {
    await db.exec("set role anon");
    await assert.rejects(
      db.query("select * from students"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select app_api('snapshot','{}',null,null)"),
      /permission denied/,
    );
    await db.exec("reset role");
    await db.exec("set role authenticated");
    await assert.rejects(
      db.query("insert into admins values($1)", [outsider]),
      /permission denied/,
    );
    await db.exec("reset role");
    const r = await db.query<{ count: number }>(
      "select count(*)::int as count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity",
    );
    assert.equal(r.rows[0].count, 0);
  });
  await t.test("만료 QR 거부", async () => {
    await db.query(
      "insert into qr_tokens values($1,now()-interval '1 second',$2)",
      ["expired", admin],
    );
    await assert.rejects(
      call(
        "attendance",
        { direction: "in", qr_hash: "expired", request_id: randomUUID() },
        null,
        "session-a",
      ),
      /QR이 만료/,
    );
  });
  await call("qr", { token_hash: "valid" });
  await t.test("동일 요청 재전송·경합 요청·중복 입실·재입실", async () => {
    const request = randomUUID();
    await call(
      "attendance",
      { direction: "in", qr_hash: "valid", request_id: request },
      null,
      "session-a",
    );
    await call(
      "attendance",
      { direction: "in", qr_hash: "valid", request_id: request },
      null,
      "session-a",
    );
    const results = await Promise.allSettled([
      call(
        "attendance",
        { direction: "in", qr_hash: "valid", request_id: randomUUID() },
        null,
        "session-a",
      ),
      call(
        "attendance",
        { direction: "in", qr_hash: "valid", request_id: randomUUID() },
        null,
        "session-a",
      ),
    ]);
    assert.equal(results.filter((r) => r.status === "rejected").length, 2);
    await call(
      "attendance",
      { direction: "out", qr_hash: "valid", request_id: randomUUID() },
      null,
      "session-a",
    );
    await assert.rejects(
      call(
        "attendance",
        { direction: "out", qr_hash: "valid", request_id: randomUUID() },
        null,
        "session-a",
      ),
      /입실 기록/,
    );
    await call(
      "attendance",
      { direction: "in", qr_hash: "valid", request_id: randomUUID() },
      null,
      "session-a",
    );
    const records = await db.query("select * from visits where student_id=$1", [
      a,
    ]);
    assert.equal(records.rows.length, 2);
    assert.equal(records.rows.filter((v: any) => !v.exited_at).length, 1);
  });
  await t.test("DB 고유 제약으로 두 열린 구간 거부", async () => {
    await assert.rejects(
      db.query("insert into visits(student_id) values($1)", [a]),
      /one_open_visit/,
    );
  });
  await t.test("좌석 중복·없는 좌석·원자적 롤백", async () => {
    await assert.rejects(
      call("assign", {
        pairs: [
          { student_id: a, seat_id: 1 },
          { student_id: b, seat_id: 1 },
        ],
      }),
      /unique/,
    );
    await assert.rejects(
      call("assign", { pairs: [{ student_id: a, seat_id: 999 }] }),
      /불가능/,
    );
    const snapshot = await call("snapshot");
    assert.equal(snapshot.students.find((s: any) => s.id === b).seat_id, 2);
    await call("assign", {
      pairs: [
        { student_id: a, seat_id: 2 },
        { student_id: b, seat_id: 1 },
      ],
    });
    const changed = await call("snapshot");
    assert.equal(changed.students.find((s: any) => s.id === a).seat_id, 2);
    const history = await db.query("select * from seat_history");
    assert.equal(history.rows.length, 1);
  });
  await t.test("수정 사유·수정 전후·수정자 보관", async () => {
    const snapshot = await call("snapshot");
    const v = snapshot.visits.find((v: any) => !v.exited_at);
    await assert.rejects(
      call("correct", {
        id: v.id,
        entered_at: v.entered_at,
        exited_at: null,
        reason: "",
      }),
      /사유/,
    );
    await call("correct", {
      id: v.id,
      entered_at: v.entered_at,
      exited_at: new Date().toISOString(),
      reason: "실제 퇴실 확인",
    });
    const result = await call("snapshot");
    const audit = result.audits.find((a: any) => a.kind === "correct");
    assert.equal(audit.actor, admin);
    assert.equal(audit.before_value.exited_at, null);
    assert.ok(audit.after_value.exited_at);
  });
  await t.test("재발급·이용 중지·세션 만료 및 기록 보존", async () => {
    await call("code", { student_id: a, code_hash: "new" });
    await assert.rejects(call("snapshot", {}, null, "session-a"), /세션/);
    await assert.rejects(
      call("login", { code_hash: "hash-a", token_hash: "other" }, null),
      /코드/,
    );
    await call("login", { code_hash: "new", token_hash: "new-session" }, null);
    await db.query(
      "update student_sessions set expires_at=now()-interval '1 second' where token_hash='new-session'",
    );
    await assert.rejects(call("snapshot", {}, null, "new-session"), /세션/);
    await call("student", {
      id: b,
      name: "가상 B",
      number: "B",
      active: false,
    });
    await assert.rejects(call("snapshot", {}, null, "session-b"), /세션/);
    assert.equal(
      (await db.query("select * from visits where student_id=$1", [a])).rows
        .length,
      2,
    );
  });
  await t.test("원자적 로그인 제한", async () => {
    for (let i = 0; i < 10; i++) {
      const r = await db.query<{ ok: boolean }>(
        "select consume_login_limit($1) as ok",
        ["code:test"],
      );
      assert.equal(r.rows[0].ok, true);
    }
    const r = await db.query<{ ok: boolean }>(
      "select consume_login_limit($1) as ok",
      ["code:test"],
    );
    assert.equal(r.rows[0].ok, false);
  });
  await db.close();
});
