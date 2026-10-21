import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
test("Edge HTTP 인증·허용 origin·형식·해시·서버 신원 선택", async (t) => {
  let handler: (r: Request) => Promise<Response> = async () => new Response();
  const calls: any[] = [];
  let limiter = true;
  const globals = globalThis as any;
  globals.Deno = {
    env: {
      get: (key: string) =>
        (
          ({
            SUPABASE_URL: "https://test.supabase.co",
            SUPABASE_SERVICE_ROLE_KEY: "server-only-fixture",
            CODE_PEPPER: "test-only-pepper-never-production",
            ALLOWED_ORIGINS: "https://test.example",
          }) as Record<string, string>
        )[key],
    },
    serve: (h: any) => {
      handler = h;
    },
  };
  globals.__edgeClient = {
    auth: {
      getUser: async (jwt: string) =>
        jwt === "verified-teacher"
          ? { data: { user: { id: "teacher-id" } }, error: null }
          : { data: { user: null }, error: Error("invalid") },
    },
    rpc: async (name: string, args: any) => {
      calls.push({ name, args });
      if (name === "consume_login_limit") return { data: limiter, error: null };
      if (name === "get_site_copy")
        return { data: { hero_title: "Public copy" }, error: null };
      if (name === "code_digest") return { data: "a".repeat(64), error: null };
      if (name === "attendance_daily_source")
        return {
          data: {
            daily_source: [],
            selected: args.p_student_session
              ? "student-id"
              : args.p_payload.student_id,
            server_now: "2026-10-19T17:00:00+09:00",
          },
          error: null,
        };
      if (name === "period_attendance_bulk")
        return { data: { day: "2026-10-19", sessions: [] }, error: null };
      if (name === "issue_student_code")
        return args.p_admin === "teacher-id"
          ? { data: { code: "B7K2P" }, error: null }
          : { data: null, error: Error("관리자 권한이 필요합니다.") };
      if (name === "classroom_qr")
        return args.p_admin === "teacher-id"
          ? {
              data: {
                token: "SH1." + (args.p_rotate ? "b" : "a").repeat(64),
                fixed: true,
              },
              error: null,
            }
          : { data: null, error: Error("관리자 권한이 필요합니다.") };
      return {
        data:
          args.p_action === "login"
            ? { student_id: "student-id" }
            : { ok: true },
        error: null,
      };
    },
  };
  const compiled = await build({
    entryPoints: [
      fileURLToPath(
        new URL("../supabase/functions/api/index.ts", import.meta.url),
      ),
    ],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    plugins: [
      {
        name: "mock-supabase",
        setup(b) {
          b.onResolve({ filter: /^npm:@supabase\/supabase-js/ }, () => ({
            path: "client",
            namespace: "mock",
          }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
            contents:
              "export const createClient = () => globalThis.__edgeClient;",
            loader: "js",
          }));
        },
      },
    ],
  });
  await import(
    "data:text/javascript;base64," +
      Buffer.from(compiled.outputFiles[0].contents).toString("base64")
  );
  const send = (
    action: string,
    payload: any = {},
    headers: Record<string, string> = {},
  ) =>
    handler(
      new Request("https://server.test/api", {
        method: "POST",
        headers: {
          origin: "https://test.example",
          "Content-Type": "application/json",
          ...headers,
        },
        body: JSON.stringify({ action, payload }),
      }),
    );
  await t.test("origin·메서드·익명·위조 JWT 거부", async () => {
    assert.equal(
      (await send("snapshot", {}, { origin: "https://evil.test" })).status,
      403,
    );
    assert.equal(
      (await handler(new Request("https://server.test/api"))).status,
      405,
    );
    assert.equal((await send("snapshot")).status, 401);
    assert.deepEqual(
      await (await send("public_copy", { p_admin: "spoof" })).json(),
      { hero_title: "Public copy" },
    );
    assert.equal(
      (await send("snapshot", {}, { Authorization: "Bearer forged" })).status,
      401,
    );
  });
  await t.test(
    "교사는 경고카드만 관리하고 다른 쓰기는 RPC 전에 차단",
    async () => {
      const login = await send("teacher_login", {
        code: "TV-" + "A".repeat(32),
      });
      assert.equal(login.status, 200);
      assert.match((await login.json()).token, /^[a-f0-9]{64}$/);
      const headers = {
        "x-teacher-session": "c".repeat(64),
        Authorization: "Bearer verified-teacher",
      };
      calls.length = 0;
      assert.equal(
        (await send("snapshot", { p_admin: "teacher-id" }, headers)).status,
        200,
      );
      assert.equal(calls.at(-1).name, "snapshot_with_warnings");
      assert.match(calls.at(-1).args.p_viewer_session, /^[a-f0-9]{64}$/);
      assert.equal(calls.at(-1).args.p_admin, undefined);
      await send("supervision", { p_admin: "spoof" }, headers);
      assert.equal(calls.at(-1).name, "supervision_api");
      assert.equal(calls.at(-1).args.p_action, "read");
      assert.equal(calls.at(-1).args.p_admin, undefined);
      assert.match(calls.at(-1).args.p_viewer_session, /^[a-f0-9]{64}$/);
      for (const action of ["warning_issue", "warning_delete"]) {
        calls.length = 0;
        assert.equal(
          (await send(action, { p_admin: "spoof", reason: "fixture" }, headers))
            .status,
          200,
        );
        assert.equal(calls.at(-1).name, "teacher_warning_api");
        assert.equal(calls.at(-1).args.p_action, action);
        assert.match(calls.at(-1).args.p_session, /^[a-f0-9]{64}$/);
        assert.notEqual(
          calls.at(-1).args.p_session,
          headers["x-teacher-session"],
        );
        assert.equal(calls.at(-1).args.p_admin, undefined);
      }
      for (const action of [
        "student",
        "student_delete",

        "student_code",
        "visit_delete",
        "visits_delete",
        "supervision_save",
        "sheet_sync",
        "sheet_sync_status",
        "sheet_sync_setup",
        "sheet_sync_configure",
        "roster_import",
        "supervision_import",
        "cleaning_save",
        "cleaning_delete",
        "cleaning_notice_save",
        "menu_order_save",
        "site_copy",
        "student_gender",
        "code",
        "teacher_code",
        "teacher_code_rotate",
        "qr",
        "qr_rotate",
        "assign",
        "attendance",
        "correct",
        "settings",
        "notice",
        "reply",
        "suggest",
      ]) {
        calls.length = 0;
        assert.equal((await send(action, {}, headers)).status, 403, action);
        assert.equal(calls.length, 0);
      }
    },
  );
  await t.test("수동 입퇴실: 교사 허용·학생 거부·인증 인자 보호", async () => {
    assert.equal(
      (await send("manual", {}, { "x-student-session": "a".repeat(64) }))
        .status,
      403,
    );
    for (const headers of [
      { "x-teacher-session": "a".repeat(64) },
      { Authorization: "Bearer verified-teacher" },
    ] as Record<string, string>[]) {
      const r = await send(
        "manual",
        { student_id: "target", p_admin: "forged" },
        headers,
      );
      assert.equal(r.status, 200);
      const last = calls.at(-1);
      assert.equal(last.name, "staff_manual_attendance");
      assert.notEqual(last.args.p_admin, "forged");
      if (headers["x-teacher-session"]) {
        assert.match(last.args.p_viewer_session, /^[a-f0-9]{64}$/);
        assert.notEqual(
          last.args.p_viewer_session,
          headers["x-teacher-session"],
        );
      }
    }
  });
  await t.test(
    "교시 출석은 학생 거부·검증된 교사 및 관리자 신원만 전달",
    async () => {
      assert.equal(
        (await send("period_attendance", { day: "2026-10-16" })).status,
        401,
      );
      calls.length = 0;
      assert.equal(
        (
          await send(
            "period_attendance_save",
            { p_admin: "spoof" },
            { "x-student-session": "a".repeat(64) },
          )
        ).status,
        403,
      );
      assert.equal(calls.length, 0);
      assert.equal(
        (
          await send(
            "period_attendance_bulk",
            { p_admin: "spoof" },
            { "x-student-session": "a".repeat(64) },
          )
        ).status,
        403,
      );
      assert.equal(calls.length, 0);
      await send(
        "period_attendance",
        { day: "2026-10-16", p_admin: "spoof" },
        { "x-teacher-session": "b".repeat(64) },
      );
      assert.equal(calls.at(-1).name, "period_attendance_api");
      assert.equal(calls.at(-1).args.p_admin, null);
      assert.match(calls.at(-1).args.p_viewer_session, /^[a-f0-9]{64}$/);
      assert.notEqual(calls.at(-1).args.p_viewer_session, "b".repeat(64));
      await send(
        "period_attendance",
        { day: "2026-10-16" },
        { Authorization: "Bearer verified-teacher" },
      );
      assert.equal(calls.at(-1).args.p_admin, "teacher-id");
      for (const headers of <Record<string, string>[]>[
        { "x-teacher-session": "b".repeat(64) },
        { Authorization: "Bearer verified-teacher" },
      ]) {
        const r = await send(
          "period_attendance_bulk",
          { day: "2026-10-19", p_admin: "spoof", p_viewer_session: "spoof" },
          headers,
        );
        assert.equal(r.status, 200);
        assert.equal(calls.at(-1).name, "period_attendance_bulk");
        assert.notEqual(calls.at(-1).args.p_admin, "spoof");
        if (headers["x-teacher-session"]) {
          assert.equal(calls.at(-1).args.p_admin, null);
          assert.match(calls.at(-1).args.p_viewer_session, /^[a-f0-9]{64}$/);
        } else assert.equal(calls.at(-1).args.p_admin, "teacher-id");
      }
    },
  );
  await t.test(
    "교사의 구글 연결 확인·수동 반영은 서버에서도 차단",
    async () => {
      for (const action of [
        "period_attendance_connection",
        "period_attendance_sync",
      ]) {
        calls.length = 0;
        const response = await send(
          action,
          { day: "2026-10-16" },
          { "x-teacher-session": "b".repeat(64) },
        );
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, /관리자만/);
        assert.equal(calls.length, 0);
      }
    },
  );
  await t.test("세션 토큰 해시·클라이언트 관리자 주장 무시", async () => {
    const r = await send(
      "snapshot",
      { p_admin: "evil", student_id: "other" },
      { "x-student-session": "a".repeat(64) },
    );
    assert.equal(r.status, 200);
    const call = calls.at(-1);
    assert.equal(call.args.p_admin, null);
    assert.match(call.args.p_session, /^[a-f0-9]{64}$/);
    assert.notEqual(call.args.p_session, "a".repeat(64));
  });
  await t.test(
    "일괄 삭제도 JWT 검증 신원만 사용하고 학생 권한 상승 주장을 무시",
    async () => {
      const payload = {
        ids: ["fixture-record"],
        reason: "테스트",
        p_admin: "spoof",
      };
      await send("visits_delete", payload, {
        Authorization: "Bearer verified-teacher",
      });
      assert.equal(calls.at(-1).name, "delete_visits");
      assert.equal(calls.at(-1).args.p_admin, "teacher-id");
      assert.deepEqual(calls.at(-1).args.p_visits, payload.ids);
      await send("visits_delete", payload, {
        "x-student-session": "a".repeat(64),
      });
      assert.equal(calls.at(-1).args.p_admin, null);
    },
  );
  await t.test(
    "감독표도 검증 신원만 전달하고 학생·익명 권한 상승 무시",
    async () => {
      assert.equal((await send("supervision")).status, 401);
      await send(
        "supervision_save",
        { slots: [], p_admin: "spoof" },
        { Authorization: "Bearer verified-teacher" },
      );
      assert.equal(calls.at(-1).name, "supervision_api");
      assert.equal(calls.at(-1).args.p_admin, "teacher-id");
      assert.equal(calls.at(-1).args.p_action, "save");
      await send(
        "supervision",
        { p_admin: "spoof", p_viewer_session: "spoof" },
        { "x-student-session": "a".repeat(64) },
      );
      assert.equal(calls.at(-1).args.p_admin, null);
      assert.equal(calls.at(-1).args.p_viewer_session, undefined);
    },
  );
  await t.test(
    "청소표 학생·교사 조회와 관리자 수정은 서버 인증 신원만 사용",
    async () => {
      assert.equal((await send("cleaning")).status, 401);
      await send(
        "cleaning",
        { p_admin: "spoof" },
        { "x-student-session": "a".repeat(64) },
      );
      assert.equal(calls.at(-1).name, "cleaning_api");
      assert.equal(calls.at(-1).args.p_admin, null);
      assert.equal(calls.at(-1).args.p_action, "read");
      assert.equal(calls.at(-1).args.p_student_session.length, 64);
      await send(
        "cleaning",
        { p_admin: "spoof" },
        { "x-teacher-session": "b".repeat(64) },
      );
      assert.equal(calls.at(-1).args.p_viewer_session.length, 64);
      assert.equal(calls.at(-1).args.p_admin, undefined);
      await send(
        "cleaning_save",
        { slots: [], p_admin: "spoof" },
        { Authorization: "Bearer verified-teacher" },
      );
      assert.equal(calls.at(-1).args.p_admin, "teacher-id");
      assert.equal(calls.at(-1).args.p_action, "save");
    },
  );
  await t.test(
    "순위 조회는 학생 본인 세션·교사 세션·관리자 검증 신원만 전달",
    async () => {
      assert.equal((await send("weekly_ranking")).status, 401);
      await send(
        "weekly_ranking",
        { p_admin: "spoof", student_id: "other", scope: "day" },
        { "x-student-session": "a".repeat(64) },
      );
      assert.equal(calls.at(-1).name, "study_ranking");
      assert.equal(calls.at(-1).args.p_scope, "day");
      assert.equal(calls.at(-1).args.p_admin, null);
      assert.equal(calls.at(-1).args.p_student_session.length, 64);
      assert.equal(calls.at(-1).args.student_id, undefined);
      await send(
        "weekly_ranking",
        { p_admin: "spoof" },
        { "x-teacher-session": "b".repeat(64) },
      );
      assert.equal(calls.at(-1).args.p_viewer_session.length, 64);
      assert.equal(calls.at(-1).args.p_admin, undefined);
      await send(
        "weekly_ranking",
        { p_admin: "spoof" },
        { Authorization: "Bearer verified-teacher" },
      );
      assert.equal(calls.at(-1).args.p_admin, "teacher-id");
    },
  );
  await t.test("구글 시트 연결 정보 요청도 서버 검증 신원만 전달", async () => {
    assert.equal(
      (await send("collection_history", { kind: "clovers" })).status,
      401,
    );
    await send(
      "collection_history",
      { kind: "clovers", student_id: "selected", offset: 50, p_admin: "spoof" },
      { "x-student-session": "a".repeat(64) },
    );
    assert.equal(calls.at(-1).name, "collection_history");
    assert.equal(calls.at(-1).args.p_admin, null);
    assert.equal(calls.at(-1).args.p_kind, "clovers");
    assert.equal(calls.at(-1).args.p_student, "selected");
    assert.equal(calls.at(-1).args.p_offset, 50);
    assert.equal(calls.at(-1).args.p_student_session.length, 64);
    await send(
      "collection_history",
      { kind: "crowns", student_id: "selected", p_admin: "spoof" },
      { "x-teacher-session": "b".repeat(64) },
    );
    assert.equal(calls.at(-1).args.p_admin, undefined);
    assert.equal(calls.at(-1).args.p_viewer_session.length, 64);
    await send(
      "collection_history",
      { kind: "stars", student_id: "selected", p_admin: "spoof" },
      { Authorization: "Bearer verified-teacher" },
    );
    assert.equal(calls.at(-1).args.p_admin, "teacher-id");
    assert.equal((await send("sheet_sync_status")).status, 401);
    await send(
      "sheet_sync_status",
      { p_admin: "spoof" },
      { Authorization: "Bearer verified-teacher" },
    );
    assert.equal(calls.at(-1).name, "seat_sheet_sync");
    assert.equal(calls.at(-1).args.p_admin, "teacher-id");
    assert.equal(calls.at(-1).args.p_action, "status");
    await send(
      "sheet_sync_setup",
      { p_admin: "spoof" },
      { "x-student-session": "a".repeat(64) },
    );
    assert.equal(calls.at(-1).args.p_admin, null);
  });
  await t.test("JWT 검증한 신원만 DB에 전달", async () => {
    await send(
      "snapshot",
      { p_admin: "evil" },
      { Authorization: "Bearer verified-teacher" },
    );
    assert.equal(calls.at(-1).args.p_admin, "teacher-id");
  });
  await t.test("로그인 평문 코드 미저장·시도 제한·무작위 세션", async () => {
    const code = "SH-0123456789ABCDEF0123456789ABCDEF";
    const r = await send("login", { code });
    const body = await r.json();
    assert.match(body.token, /^[a-f0-9]{64}$/);
    const args = calls.at(-1).args;
    assert.notEqual(args.p_payload.token_hash, body.token);
    assert.equal(args.p_payload.code, undefined);
    assert.match(args.p_payload.code_hash, /^[a-f0-9]{64}$/);
    assert.notEqual(args.p_payload.code_hash, code);
    limiter = false;
    assert.equal((await send("login", { code })).status, 429);
    limiter = true;
    assert.equal((await send("login", { code: " b7k2p " })).status, 200);
    assert.equal((await send("teacher_login", { code: "B7K2P" })).status, 200);
    for (const invalid of ["AB12", "ABC123", "AB!2P"]) {
      assert.equal((await send("login", { code: invalid })).status, 400);
    }
  });
  await t.test("외부 URL QR 거부·개인정보 미포함 QR·재발급 해시", async () => {
    assert.equal(
      (
        await send(
          "attendance",
          { qr: "https://evil.test" },
          { "x-student-session": "a".repeat(64) },
        )
      ).status,
      400,
    );
    const r = await send(
      "qr",
      {},
      { Authorization: "Bearer verified-teacher" },
    );
    const body = await r.json();
    assert.match(body.token, /^SH1\.[a-f0-9]{64}$/);
    assert.equal(calls.at(-1).name, "classroom_qr");
    assert.equal(calls.at(-1).args.p_rotate, false);
    const repeated = await send(
      "qr",
      {},
      { Authorization: "Bearer verified-teacher" },
    );
    assert.equal((await repeated.json()).token, body.token);
    const rotated = await send(
      "qr_rotate",
      {},
      { Authorization: "Bearer verified-teacher" },
    );
    assert.notEqual((await rotated.json()).token, body.token);
    assert.notEqual(
      (await send("qr_rotate", {}, { "x-student-session": "a".repeat(64) }))
        .status,
      200,
    );
    const cr = await send(
      "code",
      { student_id: "student-id", code: "chosen-unsafe" },
      { Authorization: "Bearer verified-teacher" },
    );
    const issued = await cr.json();
    assert.match(issued.code, /^[A-Z0-9]{5}$/);
    assert.equal(calls.at(-1).name, "issue_student_code");
    assert.equal(calls.at(-1).args.p_admin, "teacher-id");
    assert.equal(calls.at(-1).args.p_student, "student-id");
  });
  await t.test("출결 집계는 신뢰한 세션만 RPC 인증인자로 전달", async () => {
    const identities: Record<string, string>[] = [
      { "x-student-session": "a".repeat(64) },
      { "x-teacher-session": "b".repeat(64) },
      { Authorization: "Bearer verified-teacher" },
    ];
    for (const headers of identities) {
      const r = await send(
        "attendance_summary",
        {
          start: "2026-10-01",
          end: "2026-10-31",
          p_admin: "forged",
          p_student_session: "forged",
        },
        headers,
      );
      assert.equal(r.status, 200);
      const last = calls.at(-1);
      assert.equal(last.name, "attendance_daily_source");
      assert.notEqual(last.args.p_admin, "forged");
      assert.notEqual(last.args.p_student_session, "forged");
      if ("x-student-session" in headers) {
        assert.match(last.args.p_student_session, /^[a-f0-9]{64}$/);
        assert.notEqual(
          last.args.p_student_session,
          headers["x-student-session"],
        );
      }
    }
  });
  await t.test("Vault 모드에서 비밀키 없이 서버 해시 RPC 사용", async () => {
    const originalGet = globals.Deno.env.get;
    globals.Deno.env.get = (key: string) =>
      key === "CODE_PEPPER" ? undefined : originalGet(key);
    const originalRpc = globals.__edgeClient.rpc;
    globals.__edgeClient.rpc = async (name: string, args: any) => {
      if (name === "code_digest") {
        calls.push({ name, args });
        return { data: "d".repeat(64), error: null };
      }
      return originalRpc(name, args);
    };
    await import(
      "data:text/javascript;base64," +
        Buffer.from(compiled.outputFiles[0].contents).toString("base64") +
        "#vault-mode"
    );
    const response = await send("login", {
      code: "SH-0123456789ABCDEF0123456789ABCDEF",
    });
    assert.equal(response.status, 200);
    assert.ok(calls.some((c) => c.name === "code_digest"));
    assert.equal(calls.at(-1).args.p_payload.code_hash, "d".repeat(64));
  });
  delete globals.Deno;
  delete globals.__edgeClient;
});
