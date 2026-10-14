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
      if (name === "code_digest") return { data: "a".repeat(64), error: null };
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
    assert.equal(
      (await send("snapshot", {}, { Authorization: "Bearer forged" })).status,
      401,
    );
  });
  await t.test(
    "교사 뷰어는 읽기만 전달하고 모든 쓰기를 RPC 전에 차단",
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
      assert.equal(calls.at(-1).name, "teacher_viewer_api");
      assert.deepEqual(calls.at(-1).args.p_payload, {});
      for (const action of [
        "student",
        "student_gender",
        "code",
        "teacher_code",
        "teacher_code_rotate",
        "qr",
        "qr_rotate",
        "assign",
        "manual",
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
    assert.match(issued.code, /^SH-[A-F0-9]{32}$/);
    assert.equal(calls.at(-1).args.p_payload.code, undefined);
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
