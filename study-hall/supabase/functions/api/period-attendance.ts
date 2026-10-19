import { callSeatSheet } from "./seat-sheet-sync.ts";
const labels: Record<string, string> = {
  present: "출석",
  late: "지각",
  absent: "결석",
  excused: "인정결석",
};
export function attendanceSheetRows(source: any) {
  const rows = new Map<string, any>();
  const weekday = new Date(`${source.day}T12:00:00+09:00`).getUTCDay();
  for (const session of source.sessions) {
    for (const entry of session.entries) {
      if (!session.confirmed && !entry.confirmed) continue;
      let row = rows.get(entry.student_id);
      if (!row) {
        row = {
          student_id: entry.student_id,
          number: entry.number,
          name: entry.name,
          statuses: Array.from({ length: 7 }, (_, i) =>
            i === 6 && weekday >= 3 ? "—" : "",
          ),
          notes: [] as string[],
        };
        rows.set(entry.student_id, row);
      }
      row.statuses[session.period - 1] = labels[entry.status];
      if (entry.exempt_reason)
        row.notes.push(
          `${session.period}교시 퇴출 집계 제외: ${entry.exempt_reason}`,
        );
      if (entry.note) row.notes.push(`${session.period}교시: ${entry.note}`);
    }
  }
  return [...rows.values()]
    .sort((a, b) => a.number.localeCompare(b.number, "ko", { numeric: true }))
    .map((r) => ({
      number: r.number,
      name: r.name,
      statuses: r.statuses,
      note: r.notes.join(" / "),
    }));
}
export const periodActions = [
  "period_attendance",
  "period_attendance_save",
  "period_attendance_bulk",
  "period_attendance_reset",
  "period_attendance_sync",
  "period_attendance_connection",
];
export function shouldSyncAttendance(day: string, sessions: any[]) {
  const weekday = new Date(`${day}T12:00:00+09:00`).getUTCDay();
  const last = weekday === 1 || weekday === 2 ? 7 : 6;
  return sessions.some(
    (s) => (s.period === last && s.confirmed) || s.synced_revision > 0,
  );
}
export async function handlePeriodAttendance(
  db: any,
  action: string,
  payload: any,
  admin: string | null,
  viewerSession: string | null,
) {
  if (
    !admin &&
    ["period_attendance_connection", "period_attendance_sync"].includes(action)
  )
    throw Error("구글 시트 연결·수동 반영은 관리자만 가능합니다.");
  const run = async (operation: string, input: any = payload) => {
    const { data, error } = await db.rpc(
      operation === "bulk" ? "period_attendance_bulk" : "period_attendance_api",
      {
        ...(operation === "bulk" ? {} : { p_action: operation }),
        p_payload: input,
        p_admin: admin,
        p_viewer_session: viewerSession,
      },
    );
    if (error) throw Error(error.message);
    return data;
  };
  if (action === "period_attendance") return await run("read");
  if (action === "period_attendance_connection") {
    const source = await run("sync_payload");
    const check = await callSeatSheet(
      source.endpoint,
      source.secret,
      "check",
      source.spreadsheet_id,
    );
    if (check.attendance !== true)
      throw Error("구글 연결코드 업데이트가 필요합니다.");
    return { ready: true };
  }
  if (action !== "period_attendance_sync") {
    const saved = await run(
      action === "period_attendance_save"
        ? "save"
        : action === "period_attendance_bulk"
          ? "bulk"
          : "reset",
    );
    if (!shouldSyncAttendance(payload.day, saved.sessions))
      return { ...saved, sheet_deferred: true };
  }
  let sheet_sync;
  try {
    const source = await run("sync_payload");
    if (!source.sessions.length) throw Error("저장된 출석이 없습니다.");
    const check = await callSeatSheet(
      source.endpoint,
      source.secret,
      "check",
      source.spreadsheet_id,
    );
    if (check.attendance !== true)
      throw Error(
        "구글 연결코드 업데이트가 필요합니다. 관리자의 출석관리 연결 안내를 확인하세요.",
      );
    const result = await callSeatSheet(
      source.endpoint,
      source.secret,
      "attendance",
      source.spreadsheet_id,
      undefined,
      {
        day: source.day,
        generation: Number(source.generation),
        rows: attendanceSheetRows(source),
      },
    );
    await run("mark_synced", {
      day: payload.day,
      generation: source.generation,
    });
    sheet_sync = { ok: true, url: result.url };
  } catch (error) {
    sheet_sync = { ok: false, error: (error as Error).message };
  }
  return { ...(await run("read")), sheet_sync };
}
