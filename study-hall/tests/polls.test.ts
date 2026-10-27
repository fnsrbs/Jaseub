import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("투표 DB: 인증·중복·익명·기명·마감·직접 접근 차단", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table admins(user_id uuid);
      create table students(id uuid primary key,number text,name text,active boolean default true,deleted_at timestamptz);
      create table student_codes(student_id uuid,version int);
      create table student_sessions(student_id uuid,version int,token_hash text,expires_at timestamptz);
      create table teacher_viewer_code(id boolean,version int);
      create table teacher_viewer_sessions(version int,token_hash text,expires_at timestamptz);
      insert into admins values('00000000-0000-0000-0000-000000000001');
      insert into students(id,number,name) values('00000000-0000-0000-0000-000000000002','10101','학생 A'),('00000000-0000-0000-0000-000000000003','10102','학생 B');
      insert into student_codes select id,1 from students;
      insert into student_sessions select id,1,number,now()+interval '1 hour' from students;
      insert into teacher_viewer_code values(true,1);
      insert into teacher_viewer_sessions values(1,'viewer',now()+interval '1 hour');
    `);
    await db.exec(await readFile(new URL("../supabase/migrations/20261015115424_role_menu_order.sql", import.meta.url), "utf8"));
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20261027055250_student_polls.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const admin = "00000000-0000-0000-0000-000000000001";
    const call = async (
      action: string,
      payload = {},
      who: string | null = admin,
      session: string | null = null,
      viewer: string | null = null,
    ) =>
      (
        await db.query<{ value: any }>(
          "select poll_api($1,$2::jsonb,$3::uuid,$4,$5) value",
          [action, JSON.stringify(payload), who, viewer, session],
        )
      ).rows[0].value;
    await assert.rejects(call("polls", {}, null), /로그인/);
    await assert.rejects(
      call(
        "poll_create",
        { title: "질문", options: ["예", "아니오"], anonymous: true },
        null,
        "10101",
      ),
      /관리자/,
    );
    for (const options of [["예"], ["예", " 예 "], ["예", 5]])
      await assert.rejects(
        call("poll_create", { title: "질문", options, anonymous: true }),
      );
    await call("poll_create", {
      title: "자리 변경",
      options: ["찬성", "반대"],
      anonymous: true,
    });
    let poll = (await call("polls"))[0];
    await call("poll_vote", { id: poll.id, choice: 0 }, null, "10101");
    await assert.rejects(
      call("poll_vote", { id: poll.id, choice: 1 }, null, "10101"),
      /이미 참여/,
    );
    await assert.rejects(
      call("poll_vote", { id: poll.id, choice: 2 }, null, "10102"),
      /선택지/,
    );
    await assert.rejects(
      call("poll_vote", { id: poll.id, choice: 0 }, null, null, "viewer"),
      /학생만/,
    );
    assert.deepEqual((await call("polls"))[0].voters, []);
    poll = (await call("polls", {}, null, "10101"))[0];
    assert.equal(poll.my_choice, 0);
    assert.deepEqual(poll.counts, [1, 0]);
    assert.equal((await call("polls", {}, null, "10102"))[0].my_choice, null);
    await assert.rejects(
      call("poll_close", { id: poll.id }, null, "10101"),
      /관리자/,
    );
    await call("poll_close", { id: poll.id });
    await assert.rejects(
      call("poll_vote", { id: poll.id, choice: 1 }, null, "10102"),
      /마감/,
    );
    await call("poll_create", {
      title: "기명",
      options: ["예", "아니오"],
      anonymous: false,
    });
    const named = (await call("polls")).find((p: any) => !p.anonymous);
    await call("poll_vote", { id: named.id, choice: 1 }, null, "10102");
    assert.deepEqual(
      (await call("polls")).find((p: any) => p.id === named.id).voters,
      [{ number: "10102", name: "학생 B", choice: 1 }],
    );
    for (const result of [
      await call("polls", {}, null, "10101"),
      await call("polls", {}, null, null, "viewer"),
    ])
      assert.deepEqual(result.find((p: any) => p.id === named.id).voters, []);
    await db.exec("update student_codes set version=2");
    await assert.rejects(call("polls", {}, null, "10101"), /로그인/);
    await db.exec("set role anon");
    await assert.rejects(
      db.query("select * from poll_votes"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select poll_api('polls')"),
      /permission denied/,
    );
    await db.exec("reset role");
  } finally {
    await db.close();
  }
});
