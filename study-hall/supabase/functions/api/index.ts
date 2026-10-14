import { createClient } from "npm:@supabase/supabase-js@2";
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const pepper = Deno.env.get("CODE_PEPPER");
const allowed = (
  Deno.env.get("ALLOWED_ORIGINS") ||
  "https://fnsrbs.github.io,http://127.0.0.1:5173"
).split(",");
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
async function hash(value: string) {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}
async function codeHash(value: string) {
  if (!pepper) {
    const { data, error } = await db.rpc("code_digest", { p_code: value });
    if (error || typeof data !== "string" || !/^[a-f0-9]{64}$/.test(data))
      throw Error("서버 인증 설정이 필요합니다.");
    return data;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(value.trim().toUpperCase()),
      ),
    ),
  );
}
async function rpc(
  action: string,
  payload: Record<string, unknown>,
  admin: string | null = null,
  session: string | null = null,
) {
  const { data, error } = await db.rpc("app_api", {
    p_action: action,
    p_payload: payload,
    p_admin: admin,
    p_session: session,
  });
  if (error) throw Error(error.message);
  return data;
}
Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const headers = {
    "Access-Control-Allow-Origin": allowed.includes(origin)
      ? origin
      : allowed[0],
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-student-session",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  const reply = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { headers, status });
  if (origin && !allowed.includes(origin))
    return reply({ error: "허용되지 않은 사이트입니다." }, 403);
  if (req.method === "OPTIONS")
    return new Response(null, { headers, status: 204 });
  if (req.method !== "POST")
    return reply({ error: "POST 요청만 허용합니다." }, 405);
  try {
    const raw = await req.text();
    if (raw.length > 50000) return reply({ error: "요청이 너무 큽니다." }, 413);
    const { action, payload = {} } = JSON.parse(raw);
    if (typeof action !== "string") throw Error("요청 형식 오류");
    if (action === "login") {
      const code = String(payload.code || "");
      if (!/^[A-Z0-9-]{16,80}$/i.test(code)) throw Error("코드를 확인하세요.");
      const ch = await codeHash(code);
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      for (const key of ["code:" + ch, "ip:" + (await hash(ip))]) {
        const { data, error } = await db.rpc("consume_login_limit", {
          p_key: key,
        });
        if (error) throw Error("로그인 제한 확인 실패");
        if (!data)
          return reply(
            { error: "로그인 시도가 많습니다. 10분 후 다시 시도하세요." },
            429,
          );
      }
      const token = random();
      const data = await rpc("login", {
        code_hash: ch,
        token_hash: await hash(token),
      });
      return reply({ ...data, token });
    }
    let admin: string | null = null;
    let session: string | null = null;
    const studentToken = req.headers.get("x-student-session");
    if (studentToken) {
      if (!/^[a-f0-9]{64}$/.test(studentToken)) throw Error("세션 오류");
      session = await hash(studentToken);
    } else {
      const jwt = req.headers.get("authorization")?.replace(/^Bearer /i, "");
      if (!jwt) return reply({ error: "로그인이 필요합니다." }, 401);
      const { data, error } = await db.auth.getUser(jwt);
      if (error || !data.user)
        return reply({ error: "인증이 만료되었습니다." }, 401);
      admin = data.user.id;
    }
    if (action === "qr") {
      // RPC verifies admin membership before issuing the QR.
      const token = "SH1." + random();
      const result = await rpc(
        action,
        { token_hash: await hash(token) },
        admin,
        session,
      );
      return reply({ ...result, token });
    }
    if (action === "code") {
      const code = "SH-" + random().slice(0, 32).toUpperCase();
      await rpc(
        action,
        { student_id: payload.student_id, code_hash: await codeHash(code) },
        admin,
        session,
      );
      return reply({ code });
    }
    if (action === "attendance") {
      if (!/^SH1\.[a-f0-9]{64}$/.test(String(payload.qr || "")))
        throw Error("이 앱의 현장 QR만 스캔하세요.");
      return reply(
        await rpc(
          action,
          {
            direction: payload.direction,
            request_id: payload.request_id,
            qr_hash: await hash(payload.qr),
          },
          admin,
          session,
        ),
      );
    }
    const actions = [
      "snapshot",
      "logout",
      "suggest",
      "manual",
      "student",
      "settings",
      "operating_day",
      "seat",
      "assign",
      "notice",
      "notice_delete",
      "reply",
      "correct",
    ];
    if (!actions.includes(action)) throw Error("지원하지 않는 요청");
    return reply(await rpc(action, payload, admin, session));
  } catch (error) {
    return reply(
      { error: error instanceof Error ? error.message : "요청 실패" },
      400,
    );
  }
});
