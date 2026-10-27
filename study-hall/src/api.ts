import { createClient } from "@supabase/supabase-js";
import { ReadCache } from "./read-cache";
const rankingReads = new ReadCache();
const readActions = new Set([
  "polls",
  "snapshot",
  "weekly_ranking",
  "public_copy",
  "menu_order",
  "attendance_summary",
  "collection_history",
  "period_attendance",
  "period_attendance_connection",
  "cleaning",
  "cleaning_notice",
  "supervision",
  "student_code",
  "teacher_code",
  "sheet_sync_status",
  "qr",
]);
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
  if (mode !== "demo" && !supabase)
    throw Error("운영 모드의 Supabase URL과 공개 키 설정이 필요합니다.");
  const session =
    mode === "production" && !token
      ? (await supabase!.auth.getSession()).data.session
      : null;
  const load = async () => {
    if (mode === "demo") {
      const { demoApi } = await import("./demo");
      return demoApi(action, payload, role, token);
    }
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
  };
  if (action === "weekly_ranking")
    return rankingReads.read<any>(
      JSON.stringify([
        mode,
        role,
        token || session?.access_token || "",
        payload,
      ]),
      load,
    );
  const write = !readActions.has(action);
  if (write) rankingReads.clear();
  const result = await load();
  if (write) rankingReads.clear();
  return result;
}
