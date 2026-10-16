import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("월화17시·수목금16시 미퇴실만 30분 전으로 기록, 순위 가산 방지·중복방지", async () => {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create table visits(id uuid primary key,entered_at timestamptz,exited_at timestamptz,check(exited_at is null or exited_at>=entered_at));`,
  );
  const sql = await readFile(
    new URL(
      "../supabase/migrations/20261016072145_weekday_auto_checkout.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await db.exec(sql.split("-- Production scheduler:")[0]);
  const run = async (s: string) =>
    (await db.query<{ n: number }>("select weekday_auto_checkout($1) n", [s]))
      .rows[0].n;
  for (const [day, time] of [
    ["2026-10-19", "16:30"],
    ["2026-10-20", "16:30"],
    ["2026-10-21", "15:30"],
    ["2026-10-22", "15:30"],
    ["2026-10-23", "15:30"],
  ]) {
    await db.exec(
      `truncate visits;insert into visits values('00000000-0000-0000-0000-000000000001','${day}T08:00:00+09:00',null),('00000000-0000-0000-0000-000000000002','${day}T08:00:00+09:00','${day}T09:00:00+09:00'),('00000000-0000-0000-0000-000000000003','${day}T${time}:01+09:00',null);`,
    );
    assert.equal(
      await run(
        day + "T" + (time === "15:30" ? "15:59" : "16:59") + ":59+09:00",
      ),
      0,
    );
    const execution = time === "15:30" ? "16:00" : "17:00";
    assert.equal(await run(day + "T" + execution + ":00+09:00"), 2);
    assert.equal(await run(day + "T" + execution + ":30+09:00"), 0);
    const seconds = (
      await db.query<{ seconds: number }>(
        "select extract(epoch from exited_at-entered_at)::int seconds from visits where id='00000000-0000-0000-0000-000000000001'",
      )
    ).rows[0].seconds;
    assert.equal(seconds, time === "15:30" ? 27000 : 30600);
    const late = (
      await db.query<{ seconds: number }>(
        "select extract(epoch from exited_at-entered_at)::int seconds from visits where id='00000000-0000-0000-0000-000000000003'",
      )
    ).rows[0].seconds;
    assert.equal(late, 0);
    const existing = (
      await db.query<{ t: string }>(
        "select to_char(exited_at at time zone 'Asia/Seoul','HH24:MI') t from visits where id='00000000-0000-0000-0000-000000000002'",
      )
    ).rows[0].t;
    assert.equal(existing, "09:00");
    const r = (
      await db.query<{ t: string }>(
        `select to_char(exited_at at time zone 'Asia/Seoul','HH24:MI') t from visits where id='00000000-0000-0000-0000-000000000001'`,
      )
    ).rows[0];
    assert.equal(r.t, time);
  }
  assert.equal(await run("2026-10-24T17:00:00+09:00"), 0);
  assert.equal(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from auto_checkout_runs",
      )
    ).rows[0].n,
    5,
  );
  assert.equal(
    (
      await db.query<{ ok: boolean }>(
        "select has_function_privilege('anon','weekday_auto_checkout(timestamptz)','execute') ok",
      )
    ).rows[0].ok,
    false,
  );
  await db.close();
});
