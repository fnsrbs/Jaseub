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
      "authorization, apikey, content-type, x-student-session, x-teacher-session",
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
    if (action === "public_copy") {
      const { data, error } = await db.rpc("get_site_copy");
      if (error) throw Error(error.message);
      return reply(data);
    }
    if (action === "login" || action === "teacher_login") {
      const code = String(payload.code || "")
        .trim()
        .toUpperCase();
      if (!/^(?:[A-Z0-9]{5}|[A-Z0-9-]{16,80})$/i.test(code))
        throw Error("코드를 확인하세요.");
      const ch =
        action === "teacher_login" || code.length === 5
          ? (await db.rpc("code_digest", { p_code: code })).data
          : await codeHash(code);
      if (typeof ch !== "string" || !/^[a-f0-9]{64}$/.test(ch))
        throw Error("서버 인증 설정 오류");
      const ip =
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      for (const key of [
        ...(code.length === 5 ? ["ip:short-code-global"] : []),
        "code:" + ch,
        "ip:" + (await hash(ip)),
      ]) {
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
      if (action === "teacher_login") {
        const { data, error } = await db.rpc("teacher_viewer_api", {
          p_action: "login",
          p_payload: { code_hash: ch, token_hash: await hash(token) },
          p_session: null,
        });
        if (error) throw Error(error.message);
        return reply({ ...data, token });
      }
      const data = await rpc("login", {
        code_hash: ch,
        token_hash: await hash(token),
      });
      return reply({ ...data, token });
    }
    const viewerToken = req.headers.get("x-teacher-session");
    if (viewerToken) {
      if (!/^[a-f0-9]{64}$/.test(viewerToken)) throw Error("교사 세션 오류");
      if (["warning_issue", "warning_delete"].includes(action)) {
        const { data, error } = await db.rpc("teacher_warning_api", {
          p_action: action,
          p_payload: payload,
          p_session: await hash(viewerToken),
        });
        if (error) throw Error(error.message);
        return reply(data);
      }
      if (!["snapshot", "logout"].includes(action))
        return reply(
          { error: "교사는 조회 및 경고카드 관리만 가능합니다." },
          403,
        );
      const { data, error } =
        action === "snapshot"
          ? await db.rpc("snapshot_with_warnings", {
              p_viewer_session: await hash(viewerToken),
            })
          : await db.rpc("teacher_viewer_api", {
              p_action: action,
              p_payload: {},
              p_session: await hash(viewerToken),
            });
      if (error) throw Error(error.message);
      return reply(data);
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
    if (action === "snapshot") {
      const { data, error } = await db.rpc("snapshot_with_warnings", {
        p_admin: admin,
        p_session: session,
      });
      if (error) throw Error(error.message);
      return reply(data);
    }
    if (action === "warning_delete") {
      const { data, error } = await db.rpc("delete_warning", {
        p_admin: admin,
        p_card: payload.id,
        p_reason: payload.reason,
      });
      if (error) throw Error(error.message);
      return reply(data);
    }
    if (action === "warning_issue") {
      const { data, error } = await db.rpc("issue_warning", {
        p_admin: admin,
        p_student: payload.student_id,
        p_reason: payload.reason,
        p_request: payload.request_id,
      });
      if (error) throw Error(error.message);
      return reply(data);
    }
    if (action === "assign") {
      const { data, error } = await db.rpc("assign_seats", {
        p_admin: admin,
        p_payload: payload,
      });
      if (error) throw Error(error.message);
      return reply(data);
    }
    if (action === "site_copy") {
      const { data, error } = await db.rpc("set_site_copy", {
        p_admin: admin,
        p_copy: payload.copy,
      });
      if (error) throw Error(error.message);
      return reply(data);
    }
    if (action === "visit_delete") {
      const { data, error } = await db.rpc("delete_visit", {
        p_admin: admin,
        p_visit: payload.id,
        p_reason: payload.reason,
      });
      if (error) throw Error(error.message);
      return reply(data);
    }
    if (action === "student_code") {
      const { data, error } = await db.rpc("student_code", {
        p_admin: admin,
        p_student: payload.student_id,
      });
      if (error) throw Error(error.message);
      return reply(data);
    }
    if (action === "student_delete") {
      const { data, error } = await db.rpc("delete_student", {
        p_admin: admin,
        p_student: payload.id,
      });
      if (error) throw Error(error.message);
      return reply(data);
    }
    if (action === "student") {
      const { data, error } = await db.rpc("save_student", {
        p_admin: admin,
        p_payload: payload,
      });
      if (error) throw Error(error.message);
      return reply(data);
    }
    if (action === "student_gender") {
      const { data, error } = await db.rpc("set_student_gender", {
        p_admin: admin,
        p_ids: payload.ids,
        p_gender: payload.gender,
      });
      if (error) throw Error(error.message);
      return reply(data);
    }
    if (action === "teacher_code" || action === "teacher_code_rotate") {
      const { data, error } = await db.rpc("teacher_access", {
        p_admin: admin,
        p_rotate: action === "teacher_code_rotate",
      });
      if (error) throw Error(error.message);
      return reply(data);
    }
    if (action === "qr" || action === "qr_rotate") {
      const { data, error } = await db.rpc("classroom_qr", {
        p_admin: admin,
        p_rotate: action === "qr_rotate",
      });
      if (error) throw Error(error.message);
      return reply(data);
    }
    if (action === "code") {
      const { data, error } = await db.rpc("issue_student_code", {
        p_admin: admin,
        p_student: payload.student_id,
      });
      if (error) throw Error(error.message);
      return reply(data);
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
