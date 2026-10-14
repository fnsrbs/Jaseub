import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("교사 뷰어: 코드·조회 범위·쓰기 차단·재발급·로그아웃·만료·성별 관리 권한", async () => {
  const db = new PGlite();
  try {
    // Hosted Vault encryption is replaced only in this private SQL behavior fixture.
    await db.exec(`create schema auth;create schema extensions;create schema vault;
 create role anon;create role authenticated;create role service_role;create table auth.users(id uuid primary key);
 grant usage on schema public to anon,authenticated,service_role;
 create function extensions.gen_random_uuid() returns uuid language sql as 'select gen_random_uuid()';
 create function extensions.gen_random_bytes(n integer) returns bytea language sql as 'select decode(left(replace(gen_random_uuid()::text||gen_random_uuid()::text,''-'',''''),n*2),''hex'')';
 create table vault.secrets(id uuid primary key default gen_random_uuid(),name text unique,decrypted_secret text);
 create view vault.decrypted_secrets as select * from vault.secrets;
 create function vault.create_secret(v text,n text,d text) returns uuid language sql as 'insert into vault.secrets(name,decrypted_secret) values(n,v) returning id';
 create function vault.update_secret(i uuid,v text) returns void language sql as 'update vault.secrets set decrypted_secret=v where id=i';
 create function public.code_digest(v text) returns text language sql as 'select encode(sha256(convert_to(upper(trim(v)),''UTF8'')),''hex'')';`);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    const files = fs.readdirSync(dir);
    const migration = (suffix: string) =>
      fs.readFileSync(
        new URL(
          files.find((f) => f.endsWith(suffix))!,
          dir,
        ),
        "utf8",
      );
    await db.exec(
      migration("_study_hall_initial.sql").replace(
        "create extension if not exists pgcrypto with schema extensions;",
        "",
      ),
    );
    await db.exec(migration("_student_gender_groups.sql"));
    await db.exec(migration("_teacher_viewer_access.sql"));
    const admin = crypto.randomUUID(),
      outsider = crypto.randomUUID(),
      student = crypto.randomUUID();
    await db.query("insert into auth.users values($1),($2)", [admin, outsider]);
    await db.query("insert into admins values($1)", [admin]);
    await db.query(
      "insert into students(id,name,number,seat_id) values($1,'가상학생','D001',1)",
      [student],
    );
    await db.query(
      "insert into suggestions(student_id,title,body) values($1,'비공개','숨김')",
      [student],
    );
    const access = async (who: string | null, rotate = false) =>
      (
        await db.query<{ r: any }>("select teacher_access($1,$2) r", [
          who,
          rotate,
        ])
      ).rows[0].r;
    const api = async (
      action: string,
      payload: any = {},
      session: string | null = null,
    ) =>
      (
        await db.query<{ r: any }>("select teacher_viewer_api($1,$2,$3) r", [
          action,
          JSON.stringify(payload),
          session,
        ])
      ).rows[0].r;
    const login = async (code: string, token: string) => {
      const hash = (
        await db.query<{ h: string }>("select code_digest($1) h", [code])
      ).rows[0].h;
      return api("login", { code_hash: hash, token_hash: token });
    };
    await assert.rejects(access(null), /관리자/);
    await assert.rejects(access(outsider), /관리자/);
    const code = (await access(admin)).code;
    assert.match(code, /^TV-[A-F0-9]{32}$/);
    assert.equal((await access(admin)).code, code);
    await assert.rejects(login("WRONG", "a".repeat(64)), /코드/);
    await login(code, "a".repeat(64));
    const data = await api("snapshot", {}, "a".repeat(64));
    assert.equal(data.students.length, 1);
    assert.equal(data.seats.length, 72);
    assert.equal(data.suggestions.length, 1);
    assert.deepEqual(data.audits, []);
    assert.equal(JSON.stringify(data).includes("code_hash"), false);
    for (const action of [
      "student",
      "student_gender",
      "assign",
      "manual",
      "attendance",
      "correct",
      "qr",
      "teacher_code",
      "notice",
      "reply",
      "settings",
    ])
      await assert.rejects(api(action, {}, "a".repeat(64)), /조회/);
    await assert.rejects(
      db.query("select app_api('snapshot','{}',null,$1)", ["a".repeat(64)]),
      /세션/,
    );
    const changed = (await access(admin, true)).code;
    assert.notEqual(changed, code);
    await assert.rejects(api("snapshot", {}, "a".repeat(64)), /세션/);
    await assert.rejects(login(code, "b".repeat(64)), /코드/);
    await login(changed, "b".repeat(64));
    await api("logout", {}, "b".repeat(64));
    await assert.rejects(api("snapshot", {}, "b".repeat(64)), /세션/);
    await login(changed, "c".repeat(64));
    await db.exec(
      "update teacher_viewer_sessions set expires_at=now()-interval '1 minute'",
    );
    await assert.rejects(api("snapshot", {}, "c".repeat(64)), /세션/);
    const gender = async (who: string | null, ids: string[], value: string) =>
      db.query("select set_student_gender($1,$2,$3)", [who, ids, value]);
    await assert.rejects(gender(outsider, [student], "male"), /관리자/);
    await assert.rejects(gender(null, [student], "female"), /관리자/);
    await assert.rejects(gender(admin, [student], "bad"), /성별/);
    await assert.rejects(
      gender(admin, [student, crypto.randomUUID()], "male"),
      /학생/,
    );
    assert.equal(
      (await db.query<{ gender: string }>("select gender from students"))
        .rows[0].gender,
      "unknown",
    );
    await gender(admin, [student], "male");
    assert.equal(
      (await db.query<{ gender: string }>("select gender from students"))
        .rows[0].gender,
      "male",
    );
    await db.exec("set role authenticated");
    await assert.rejects(access(admin), /permission denied/);
    await assert.rejects(
      api("snapshot", {}, "a".repeat(64)),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select * from teacher_viewer_code"),
      /permission denied/,
    );
    await assert.rejects(
      gender(admin, [student], "female"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
