import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("고정 QR: 지속성·권한·재발급·기존 인쇄본 차단", async () => {
  const db = new PGlite();
  // Vault encryption is a hosted extension. This fixture tests SQL behavior/permissions.
  await db.exec(`create schema auth;create schema extensions;create schema vault;
 create table auth.users(id uuid primary key);create role anon;create role authenticated;create role service_role;
 grant usage on schema public to anon,authenticated,service_role;
 create function extensions.gen_random_uuid() returns uuid language sql as 'select gen_random_uuid()';
 create function extensions.gen_random_bytes(n integer) returns bytea language sql as 'select decode(left(replace(gen_random_uuid()::text||gen_random_uuid()::text,''-'',''''),n*2),''hex'')';
 create function extensions.digest(t text,alg text) returns bytea language sql as 'select sha256(convert_to(t,''UTF8''))';
 create table vault.secrets(id uuid primary key default gen_random_uuid(),name text unique,decrypted_secret text,updated_at timestamptz default now());
 create view vault.decrypted_secrets as select * from vault.secrets;
 create function vault.create_secret(v text,n text,d text) returns uuid language sql as 'insert into vault.secrets(name,decrypted_secret) values(n,v) returning id';
 create function vault.update_secret(i uuid,v text) returns void language sql as 'update vault.secrets set decrypted_secret=v,updated_at=clock_timestamp() where id=i';`);
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const files = await readdir(dir);
  const initial = await readFile(
    new URL(
      files.find((f) => f.endsWith("_study_hall_initial.sql"))!,
      dir,
    ),
    "utf8",
  );
  await db.exec(
    initial.replace(
      "create extension if not exists pgcrypto with schema extensions;",
      "",
    ),
  );
  const migration = await readFile(
    new URL(
      files.find((f) => f.endsWith("_fixed_classroom_qr.sql"))!,
      dir,
    ),
    "utf8",
  );
  await db.exec(migration);
  const admin = crypto.randomUUID(),
    outsider = crypto.randomUUID();
  await db.query("insert into auth.users values($1),($2)", [admin, outsider]);
  await db.query("insert into admins values($1)", [admin]);
  const get = async (who: string | null, rotate = false) =>
    (
      await db.query<{ qr: any }>("select classroom_qr($1,$2) as qr", [
        who,
        rotate,
      ])
    ).rows[0].qr;
  await assert.rejects(get(null), /관리자/);
  await assert.rejects(get(outsider, true), /관리자/);
  const first = await get(admin),
    same = await get(admin);
  assert.match(first.token, /^SH1\.[a-f0-9]{64}$/);
  assert.equal(first.token, same.token);
  assert.equal(first.fixed, true);
  const check = async (token: string) =>
    (
      await db.query<{ ok: boolean }>(
        "select exists(select 1 from qr_tokens where token_hash=encode(extensions.digest($1,'sha256'),'hex') and expires_at>clock_timestamp()) as ok",
        [token],
      )
    ).rows[0].ok;
  assert.equal(await check(first.token), true);
  const after = await get(admin, true);
  assert.notEqual(after.token, first.token);
  assert.equal(await check(first.token), false);
  assert.equal(await check(after.token), true);
  assert.equal((await get(admin)).token, after.token);
  await db.exec("set role authenticated");
  await assert.rejects(get(admin), /permission denied/);
  await db.exec("reset role");
  await db.close();
});
