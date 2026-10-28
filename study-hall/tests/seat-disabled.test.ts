import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { SeatArrangement } from "../src/SeatArrangement";
import type { Snapshot } from "../src/domain";

test("사용 중단 사유 저장·복구·권한·배정 보호·관리자 전용 사유", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create schema auth; create schema extensions; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role; create function extensions.gen_random_uuid() returns uuid language sql as 'select gen_random_uuid()';",
    );
    for (const name of [
      "20261014142132_study_hall_initial.sql",
      "20261014153655_teacher_viewer_access.sql",
      "20261028013519_seat_disabled_reason.sql",
    ]) {
      await db.exec(
        (
          await readFile(
            new URL(`../supabase/migrations/${name}`, import.meta.url),
            "utf8",
          )
        ).replace(
          "create extension if not exists pgcrypto with schema extensions;",
          "",
        ),
      );
    }
    const admin = "00000000-0000-0000-0000-000000000001";
    const student = "00000000-0000-0000-0000-000000000002";
    await db.query("insert into auth.users values($1)", [admin]);
    await db.query("insert into admins values($1)", [admin]);
    const save = (payload: object, actor: string | null = admin) =>
      db.query("select app_api('seat',$1::jsonb,$2::uuid,null)", [
        JSON.stringify(payload),
        actor,
      ]);
    const seat = {
      id: 1,
      row: 1,
      col: 1,
      enabled: false,
      disabled_reason: "책상 파손",
    };
    await assert.rejects(save({ ...seat, disabled_reason: " " }));
    await assert.rejects(save(seat, null));
    await save(seat);
    assert.equal(
      (
        await db.query<{ disabled_reason: string }>(
          "select disabled_reason from seats where id=1",
        )
      ).rows[0].disabled_reason,
      "책상 파손",
    );
    const snapshot = (
      await db.query<{ result: Snapshot }>(
        "select app_api('snapshot','{}',$1,null) result",
        [admin],
      )
    ).rows[0].result;
    assert.equal(snapshot.seats[0].disabled_reason, "책상 파손");
    await db.exec(
      "insert into teacher_viewer_code values(true,'hash',1); insert into teacher_viewer_sessions values('session',1,now()+interval '1 hour');",
    );
    const teacher = (
      await db.query<{ result: Snapshot }>(
        "select teacher_viewer_api('snapshot','{}','session') result",
      )
    ).rows[0].result;
    assert.equal("disabled_reason" in teacher.seats[0], false);
    await save({ ...seat, enabled: true });
    assert.equal(
      (
        await db.query<{ disabled_reason: string }>(
          "select disabled_reason from seats where id=1",
        )
      ).rows[0].disabled_reason,
      "",
    );
    await db.query(
      "insert into students(id,name,number,seat_id) values($1,'가상','1',1)",
      [student],
    );
    await assert.rejects(save(seat), /배정/);
    await db.query("insert into student_codes values($1,'hash',1)", [student]);
    await db.query(
      "insert into student_sessions values('student-session',$1,1,now()+interval '1 hour')",
      [student],
    );
    const mine = (
      await db.query<{ result: Snapshot }>(
        "select app_api('snapshot','{}',null,'student-session') result",
      )
    ).rows[0].result;
    assert.equal("disabled_reason" in mine.seats[0], false);
    const html = renderToStaticMarkup(
      createElement(SeatArrangement, {
        data: snapshot,
        draft: [],
        fixed: [],
        onChange: () => {},
        onSeatSettings: () => {},
      }),
    );
    assert.match(html, /책상 파손/);
    assert.match(html, /사용 안 함/);
  } finally {
    await db.close();
  }
});
