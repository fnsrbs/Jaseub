import { createClient } from "@supabase/supabase-js";
import { demoApi } from "./demo";
export const mode = import.meta.env.VITE_APP_MODE || "demo";
if (!["demo", "production"].includes(mode))
  throw Error("VITE_APP_MODE는 demo 또는 production이어야 합니다.");
// A demo identity must never carry into a production deployment.
if (sessionStorage.getItem("sh-mode") !== mode) {
  sessionStorage.removeItem("sh-role");
  sessionStorage.removeItem("sh-token");
  sessionStorage.setItem("sh-mode", mode);
}
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase =
  mode === "production" && url && key
    ? createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true },
      })
    : null;
export async function api(
  action: string,
  payload: unknown = {},
  role: "teacher" | "student" | "viewer" | null = null,
  token: string | null = null,
) {
  if (mode === "demo") return demoApi(action, payload, role, token);
  if (!supabase)
    throw Error("운영 모드의 Supabase URL과 공개 키 설정이 필요합니다.");
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const response = await fetch(`${url}/functions/v1/api`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      ...(token
        ? {
            [role === "viewer" ? "x-teacher-session" : "x-student-session"]:
              token,
          }
        : session
          ? { Authorization: `Bearer ${session.access_token}` }
          : {}),
    },
    body: JSON.stringify({ action, payload }),
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "저장 실패");
  return result;
}
