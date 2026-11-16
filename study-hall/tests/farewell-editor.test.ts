import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import {
  defaultFarewellCopy,
  readFarewellCopy,
  validateFarewellCopy,
} from "../src/farewell-copy";
import { farewellVisibility } from "../src/farewell";
import { FarewellLetter } from "../src/FarewellLetter";

test("저장한 날짜·표시 여부로 학생 화면 제어, 기존 설정은 기본값 유지", () => {
  assert.deepEqual(readFarewellCopy({}), defaultFarewellCopy);
  const now = Date.parse("2026-11-16T12:00:00+09:00");
  const copy = { ...defaultFarewellCopy, farewell_date: "2026-11-16" };
  assert.deepEqual(farewellVisibility(now, copy), {
    available: true,
    autoOpen: true,
  });
  assert.deepEqual(
    farewellVisibility(now, { ...copy, farewell_enabled: "false" }),
    { available: false, autoOpen: false },
  );
  assert.throws(
    () => validateFarewellCopy({ ...copy, farewell_date: "2026-02-30" }),
    /날짜/,
  );
  assert.throws(
    () => validateFarewellCopy({ ...copy, farewell_title: " " }),
    /제목/,
  );
});

test("관리자 수정 문구와 줄바꿈을 편지에 반영하고 HTML 입력은 글자로 표시", () => {
  const copy = {
    ...defaultFarewellCopy,
    farewell_title: "새 제목\n다음 줄",
    farewell_body: "첫 문단\n다음 줄\n\n두 번째 문단<script>alert(1)</script>",
    farewell_medal_title: "우리의 훈장",
    farewell_date: "2026-11-18",
  };
  const html = renderToStaticMarkup(
    createElement(FarewellLetter, {
      name: "학생",
      seconds: 3600,
      days: 1,
      clovers: 1,
      awards: { crowns: 0, stars: 0 },
      awardsError: false,
      retry() {},
      copy,
    }),
  );
  for (const text of [
    "새 제목\n다음 줄",
    "첫 문단\n다음 줄",
    "우리의 훈장",
    "2026. 11. 18.",
    "&lt;script&gt;",
  ])
    assert.ok(html.includes(text), text);
  assert.ok(!html.includes("<script>"));
});

test("관리자만 편지 저장·잘못된 설정 거부·로그인 문구와 편지의 부분 저장 보존·감사 기록", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema auth; create schema extensions;
      create table auth.users(id uuid primary key);
      create role anon; create role authenticated; create role service_role;
      create function extensions.gen_random_uuid() returns uuid language sql as 'select gen_random_uuid()';`);
    for (const name of [
      "20261014142132_study_hall_initial.sql",
      "20261014162615_editable_login_copy.sql",
      "20261016131147_editable_ranking_message.sql",
      "20261116032957_editable_farewell_letter.sql",
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
    const outsider = "00000000-0000-0000-0000-000000000002";
    await db.query("insert into auth.users values ($1),($2)", [
      admin,
      outsider,
    ]);
    await db.query("insert into admins values ($1)", [admin]);
    const save = async (copy: unknown, who: string | null = admin) =>
      (
        await db.query<{ result: Record<string, string> }>(
          "select public.set_site_copy($1,$2::jsonb) result",
          [who, JSON.stringify(copy)],
        )
      ).rows[0].result;
    await assert.rejects(save(defaultFarewellCopy, null), /관리자/);
    await assert.rejects(save(defaultFarewellCopy, outsider), /관리자/);
    await assert.rejects(save({ farewell_enabled: true }), /문구/);
    await assert.rejects(save({ farewell_enabled: "yes" }), /표시 여부/);
    await assert.rejects(save({ farewell_date: "2026-02-30" }), /날짜/);
    await assert.rejects(save({ farewell_date: "2026-2-3" }), /날짜/);
    await assert.rejects(save({ farewell_title: " " }), /제목/);
    await assert.rejects(save({ farewell_body: "x".repeat(2001) }), /2000/);
    await assert.rejects(save({ unknown: "value" }), /항목/);
    const before = (
      await db.query<{ result: Record<string, string> }>(
        "select get_site_copy() result",
      )
    ).rows[0].result;
    const edited = await save({
      ...defaultFarewellCopy,
      farewell_title: "학생을 위한 편지",
    });
    assert.equal(edited.hero_title, before.hero_title);
    const legacy = await save({ ...before, hero_title: "로그인 제목 수정" });
    assert.equal(legacy.farewell_title, "학생을 위한 편지");
    assert.equal(legacy.hero_title, "로그인 제목 수정");
    const disabled = await save({ farewell_enabled: "false" });
    assert.equal(disabled.farewell_enabled, "false");
    assert.equal(disabled.farewell_title, "학생을 위한 편지");
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select count(*)::int count from audits where kind='site_copy'",
        )
      ).rows[0].count,
      3,
    );
    for (const role of ["anon", "authenticated"]) {
      assert.equal(
        (
          await db.query<{ allowed: boolean }>(
            `select has_function_privilege('${role}', 'public.set_site_copy(uuid,jsonb)', 'EXECUTE') allowed`,
          )
        ).rows[0].allowed,
        false,
      );
    }
  } finally {
    await db.close();
  }
});
