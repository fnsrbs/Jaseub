import { shouldSyncAttendance } from "../supabase/functions/api/attendance-completion";
import { summarizeDaily } from "../supabase/functions/api/attendance-daily";
import {
  demoStudyRanking,
  demoCollections,
  type DemoCollectionRecord,
} from "./study-ranking";
import {
  koreanDay,
  totals,
  validateAssignments,
  validQr,
  type Snapshot,
  type Student,
  type SupervisionSlot,
} from "./domain";
import { validateDeskPairs } from "./seat-pairs";
import type { CleaningSlot } from "./cleaning-plan";
let menuConfig = JSON.parse(
  localStorage.getItem("study-hall-demo-menu-order") || "null",
) || { orders: {}, revision: 1 };
let cleaning: CleaningSlot[] = JSON.parse(
  localStorage.getItem("study-hall-fictional-cleaning") || "[]",
);
let cleaningNotice = JSON.parse(
  localStorage.getItem("study-hall-fictional-cleaning-notice") || "null",
) || {
  body: "청소 당번은 3학년부에서 청소 도구를 가져와 청소해 주세요. 창문을 열어 환기하고, 청소가 끝나면 도구를 제자리에 반납해 주세요.",
  revision: 1,
};
function readDemoCopy() {
  try {
    return {
      ...defaultSiteCopy,
      ...JSON.parse(localStorage.getItem("study-hall-demo-site-copy") || "{}"),
    };
  } catch {
    return { ...defaultSiteCopy };
  }
}
const now = () => new Date().toISOString();
import { classroomSeats } from "./seat-layout";
import { defaultSiteCopy } from "./site-copy";
import {
  defaultAttendance,
  periodsForDay,
  type AttendanceDay,
  type AttendanceEntry,
} from "./period-attendance";
const id = () => crypto.randomUUID();
// Entirely fictional browser-only demonstration. Never used by production.
const initial = (): Snapshot => {
  const time = Date.now();
  const students = Array.from({ length: 72 }, (_, i) => ({
    id: `demo-${i + 1}`,
    name: `가상학생 ${String(i + 1).padStart(2, "0")}`,
    number: `D${String(i + 1).padStart(3, "0")}`,
    active: true,
    gender: (i % 4 < 2 ? "male" : "female") as Student["gender"],
    seat_id: i + 1,
  }));
  return {
    students,
    seats: classroomSeats(),
    visits: students.slice(0, 18).map((s, i) => ({
      id: id(),
      student_id: s.id,
      entered_at: new Date(time - (i + 1) * 9 * 60000).toISOString(),
      exited_at: i < 12 ? null : new Date(time - 5 * 60000).toISOString(),
    })),
    notices: [
      {
        id: id(),
        title: "온실 자습실에 오신 것을 환영합니다",
        body: "입실과 퇴실 때 현장 QR을 스캔해 주세요. 자리를 비울 때에는 퇴실 처리하고, 조용한 학습 환경을 함께 만들어 주세요.",
        important: true,
        created_at: now(),
        updated_at: now(),
      },
    ],
    suggestions: [],
    settings: { capacity: 72, exam_date: null, missing_hours: 16 },
    operating_days: [],
    current: 12,
    today: 18,
    server_now: now(),
    audits: [],
  };
};
let state: Snapshot;
try {
  state =
    JSON.parse(localStorage.getItem("study-hall-fictional-demo") || "null") ||
    initial();
} catch {
  state = initial();
}
// Upgrade only the original sample layout; retain user-edited demo positions.
if (
  state.seats.length === 72 &&
  state.seats.every(
    (s) =>
      s.row === Math.floor((s.id - 1) / 8) + 1 &&
      s.col === ((s.id - 1) % 8) + 1,
  )
) {
  const layout = classroomSeats();
  state.seats = state.seats.map((s) => ({
    ...s,
    row: layout[s.id - 1].row,
    col: layout[s.id - 1].col,
  }));
  localStorage.setItem("study-hall-fictional-demo", JSON.stringify(state));
}
const readQr = (): { token: string; fixed: boolean } => {
  try {
    return (
      JSON.parse(localStorage.getItem("study-hall-fictional-qr") || "null") || {
        token: "",
        fixed: true,
      }
    );
  } catch {
    return { token: "", fixed: true };
  }
};
let qr = readQr();
const sessions = new Map<string, string>();
const codes = new Map<string, string>();
codes.set("DEMO-STUDENT-0001", "demo-1");
codes.set("S2K9D", "demo-1");
const shortCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (;;) {
    const value = Array.from(
      crypto.getRandomValues(new Uint8Array(5)),
      (b) => alphabet[b % 32],
    ).join("");
    if (
      /[A-Z]/.test(value) &&
      /[2-9]/.test(value) &&
      !codes.has(value) &&
      value !== (localStorage.getItem("study-hall-demo-viewer-code") || "V7K2P")
    )
      return value;
  }
};
let supervision: SupervisionSlot[];
try {
  supervision = JSON.parse(
    localStorage.getItem("study-hall-fictional-supervision") || "null",
  );
} catch {
  supervision = null!;
}
if (!supervision) {
  supervision = [];
  const blocks = [
    ["2026-10-16", "2026-10-23"],
    ["2026-10-26", "2026-10-30"],
    ["2026-11-02", "2026-11-06"],
    ["2026-11-09", "2026-11-13"],
    ["2026-11-16", "2026-11-17"],
  ];
  for (const [i, [start, end]] of blocks.entries())
    for (
      let d = Date.parse(`${start}T12:00:00+09:00`);
      d <= Date.parse(`${end}T12:00:00+09:00`);
      d += 86400000
    ) {
      const day = koreanDay(new Date(d)),
        weekday = new Date(d).getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      for (let period = 1; period <= 7; period++)
        supervision.push({
          day,
          period,
          week_label: `${i + 1}주차 (${start.slice(5)}~${end.slice(5)})`,
          teacher_name: `가상교사 ${((period + i) % 4) + 1}`,
          status: "assigned",
          note: "",
          revision: 1,
        });
    }
}
const requests = new Map<string, unknown>();
const save = () =>
  localStorage.setItem("study-hall-fictional-demo", JSON.stringify(state));
export function demoReset() {
  state = initial();
  localStorage.removeItem("study-hall-period-attendance");
  save();
}
export async function demoApi(
  action: string,
  p: any,
  role: "student" | "teacher" | "viewer" | null,
  session: string | null,
): Promise<any> {
  if (action === "public_copy") return readDemoCopy();
  if (action === "teacher_login") {
    if (
      p.code !==
      (localStorage.getItem("study-hall-demo-viewer-code") || "V7K2P")
    )
      throw Error("데모 교사 코드: V7K2P");
    const token = id();
    sessions.set(token, "viewer");
    return { token, role: "viewer" };
  }
  if (action === "login") {
    const sid = codes.get(String(p.code).trim().toUpperCase());
    if (!sid || !state.students.find((s) => s.id === sid && s.active))
      throw Error("데모 코드: DEMO-STUDENT-0001");
    const token = id();
    sessions.set(token, sid);
    return { token, student_id: sid };
  }
  const sid = session ? sessions.get(session) : undefined;
  const teacher = role === "teacher";
  const viewer = role === "viewer" && sid === "viewer";
  if (!teacher && !sid)
    throw Error("데모 세션이 만료되었습니다. 다시 로그인하세요.");
  if (action === "logout") {
    if (session) sessions.delete(session);
    return {};
  }
  if (action === "snapshot") {
    const data = structuredClone(state);
    if (!teacher && !viewer)
      data.clovers =
        demoCollections(
          state.students,
          state.visits,
          Date.now(),
          Object.values(
            JSON.parse(
              localStorage.getItem("study-hall-period-attendance") || "{}",
            ),
          ).flatMap((d: any) => d.sessions),
          undefined,
          state.operating_days,
        )[sid!]?.clovers ?? 0;
    data.settings.site_copy = readDemoCopy();
    data.current = data.visits.filter((v) => !v.exited_at).length;
    data.today = new Set(
      data.visits
        .filter((v) => koreanDay(v.entered_at) === koreanDay(now()))
        .map((v) => v.student_id),
    ).size;
    data.server_now = now();
    data.warnings = (data.warnings || []).filter((w) => !w.deleted_at);
    if (viewer) {
      data.audits = [];
    } else if (!teacher) {
      data.students = data.students.filter((s) => s.id === sid);
      data.visits = data.visits.filter((v) => v.student_id === sid);
      data.suggestions = data.suggestions.filter((s) => s.student_id === sid);
      data.warnings = (data.warnings || []).filter((w) => w.student_id === sid);
      data.audits = [];
      data.operating_days = data.operating_days.map((d) => ({
        ...d,
        student_ids: d.student_ids.includes(sid!) ? [sid!] : [],
      }));
    }
    return data;
  }
  if (action === "attendance_summary") {
    if (!teacher && !viewer && p.student_id && p.student_id !== sid)
      throw Error("본인 출결만 조회할 수 있습니다.");
    const selected = teacher || viewer ? p.student_id : sid;
    const days = JSON.parse(
      localStorage.getItem("study-hall-period-attendance") || "{}",
    );
    const source = Object.values(days).flatMap((d: any) => {
      const byStudent = new Map<string, any>();
      for (const s of d.sessions)
        for (const e of s.entries) {
          if (
            (!s.confirmed && !e.confirmed) ||
            (selected && e.student_id !== selected)
          )
            continue;
          const row = byStudent.get(e.student_id) || {
            day: s.day,
            student_id: e.student_id,
            entries: [],
          };
          const op = state.operating_days.find((o) => o.day === s.day);
          if (op && !op.student_ids.includes(e.student_id)) continue;
          row.entries.push({ ...e, period: s.period });
          byStudent.set(e.student_id, row);
        }
      for (const row of byStudent.values()) {
        const op = state.operating_days.find((d) => d.day === row.day);
        row.period_count = periodsForDay(row.day, op);
        row.end_time = op?.end_time;
        const visits = state.visits.filter(
          (v) =>
            v.student_id === row.student_id &&
            koreanDay(v.entered_at) === row.day,
        );
        row.last_exit = visits.some((v) => !v.exited_at)
          ? null
          : visits
              .map((v) => v.exited_at)
              .filter(Boolean)
              .sort()
              .at(-1);
      }
      return [...byStudent.values()];
    });
    return summarizeDaily(source, { ...p, student_id: selected });
  }

  if (action === "period_attendance_connection") {
    if (!teacher)
      throw Error("구글 시트 연결·수동 반영은 관리자만 가능합니다.");
    return { ready: true };
  }
  if (
    [
      "period_attendance",
      "period_attendance_save",
      "period_attendance_bulk",
      "period_attendance_reset",
      "period_attendance_sync",
    ].includes(action)
  ) {
    if (!teacher && !viewer) throw Error("교사 또는 관리자 권한이 필요합니다.");
    if (action === "period_attendance_sync" && !teacher)
      throw Error("구글 시트 연결·수동 반영은 관리자만 가능합니다.");
    const all: Record<string, AttendanceDay> = JSON.parse(
      localStorage.getItem("study-hall-period-attendance") || "{}",
    );
    const record = structuredClone(
      all[p.day] || {
        day: p.day,
        sessions: [],
        history: [],
        sheet_configured: true,
      },
    );
    const operation = state.operating_days.find((d) => d.day === p.day);
    record.operating_day = operation || null;
    const targetStudents = state.students.filter(
      (s) => !operation || operation.student_ids.includes(s.id),
    );
    const old = record.sessions.find((s) => s.period === p.period);
    if (
      action === "period_attendance_save" ||
      action === "period_attendance_reset"
    ) {
      if (
        !p.period ||
        p.period > periodsForDay(p.day, operation) ||
        p.period < 1
      )
        throw Error("해당 요일에 없는 교시입니다.");
      if (old?.request_id !== p.request_id) {
        if ((old?.revision || 0) !== p.revision)
          throw Error(
            "다른 교사가 출석을 변경했습니다. 다시 조회한 뒤 수정하세요.",
          );
        if (action === "period_attendance_reset") {
          if (!teacher) throw Error("출석 초기화는 관리자만 가능합니다.");
          if (!old || !p.reason?.trim())
            throw Error("초기화 사유를 입력하세요.");
          old.confirmed = false;
          old.entries = old.entries.map(({ confirmed, ...entry }) => entry);
          old.revision++;
          old.request_id = p.request_id;
          old.updated_at = now();
        } else {
          if (
            old?.entries.some((e) => e.confirmed) &&
            !p.supports_individual_records
          )
            throw Error(
              "개별 저장된 출결이 있습니다. 새로고침 후 수정해 주세요.",
            );
          const roster = old?.entries || defaultAttendance(targetStudents);
          if (
            p.entries?.length !== roster.length ||
            new Set(p.entries.map((e: any) => e.student_id)).size !==
              roster.length
          )
            throw Error("출석 대상 학생을 확인하세요.");
          const entries: AttendanceEntry[] = roster.map((s) => {
            const e = p.entries.find((e: any) => e.student_id === s.student_id);
            if (
              !e ||
              !["present", "late", "absent", "excused"].includes(e.status) ||
              String(e.note || "").length > 500
            )
              throw Error("출석 상태·사유를 확인하세요.");
            return {
              ...s,
              status: e.status,
              note: String(e.note || "").trim(),
              exempt_reason:
                e.status === "excused"
                  ? String(e.exempt_reason ?? s.exempt_reason ?? "")
                      .trim()
                      .slice(0, 200)
                  : "",
            };
          });
          record.sessions = record.sessions
            .filter((s) => s.period !== p.period)
            .concat({
              day: p.day,
              period: p.period,
              entries,
              confirmed: true,
              revision: (old?.revision || 0) + 1,
              updated_at: now(),
              updated_by: teacher ? "admin:demo" : "teacher:demo",
              synced_revision: 0,
              synced_at: null,
              request_id: p.request_id,
            });
        }
        record.history.unshift({
          id: Date.now(),
          day: p.day,
          period: p.period,
          actor: teacher ? "admin:demo" : "teacher:demo",
          action: action === "period_attendance_reset" ? "reset" : "save",
          reason:
            action === "period_attendance_reset"
              ? p.reason
              : "출석 확인 완료·변경",
          created_at: now(),
          changes:
            action === "period_attendance_reset"
              ? { previous_revision: p.revision }
              : p.entries.map((e: any) => ({
                  ...e,
                  ...{
                    name: record.sessions
                      .find((s) => s.period === p.period)
                      ?.entries.find((x) => x.student_id === e.student_id)
                      ?.name,
                    number: record.sessions
                      .find((s) => s.period === p.period)
                      ?.entries.find((x) => x.student_id === e.student_id)
                      ?.number,
                  },
                  after: e.status,
                })),
        });
      }
    }
    if (action === "period_attendance_bulk") {
      const count = periodsForDay(p.day, operation),
        start = p.start_period,
        end = p.end_period,
        periods: number[] =
          p.periods ??
          (Number.isInteger(start) &&
          Number.isInteger(end) &&
          end >= start &&
          end - start < 7
            ? Array.from({ length: end - start + 1 }, (_, i) => start + i)
            : []),
        note = String(p.note || "").trim();
      if (
        !Array.isArray(periods) ||
        !periods.length ||
        periods.length > 7 ||
        new Set(periods).size !== periods.length ||
        periods.some((n) => !Number.isInteger(n) || n < 1 || n > count)
      )
        throw Error("선택한 교시를 확인하세요.");
      if (
        !["present", "late", "absent", "excused"].includes(p.status) ||
        !note ||
        note.length > 500
      )
        throw Error("출결 상태와 사유(1~500자)를 입력하세요.");
      if (!p.request_id || !p.revisions) throw Error("저장 요청을 확인하세요.");
      const key = "period-bulk:" + p.request_id,
        previous = requests.get(key);
      if (previous && previous !== JSON.stringify(p))
        throw Error("저장 요청이 중복되었습니다. 다시 시도하세요.");
      if (!previous) {
        for (const period of periods)
          if (
            (record.sessions.find((s) => s.period === period)?.revision ||
              0) !== p.revisions[period]
          )
            throw Error(
              "다른 교사가 출석을 변경했습니다. 다시 조회한 뒤 수정하세요.",
            );
        for (const period of periods) {
          const old = record.sessions.find((s) => s.period === period),
            roster =
              old?.entries ||
              defaultAttendance(
                targetStudents,
                p.day === koreanDay(new Date()) ? state.visits : [],
              ),
            before = roster.find((e) => e.student_id === p.student_id);
          if (!before)
            throw Error("선택한 교시의 출석 대상에 학생이 없습니다.");
          const entries = roster.map((e) =>
            e.student_id === p.student_id
              ? {
                  ...e,
                  status: p.status,
                  note,
                  confirmed: true,
                  exempt_reason:
                    p.status === "excused"
                      ? String(p.exempt_reason || "")
                          .trim()
                          .slice(0, 200)
                      : "",
                }
              : e,
          );
          record.sessions = record.sessions
            .filter((s) => s.period !== period)
            .concat({
              day: p.day,
              period,
              entries,
              confirmed: old?.confirmed ?? false,
              revision: (old?.revision || 0) + 1,
              updated_at: now(),
              updated_by: teacher ? "admin:demo" : "teacher:demo",
              synced_revision: old?.synced_revision ?? 0,
              synced_at: old?.synced_at ?? null,
              request_id: p.request_id,
            });
          record.history.unshift({
            id: Date.now() + period,
            day: p.day,
            period,
            actor: teacher ? "admin:demo" : "teacher:demo",
            action: "bulk",
            reason: "학생별 여러 교시 변경",
            created_at: now(),
            changes: [
              {
                student_id: p.student_id,
                number: before.number,
                name: before.name,
                before:
                  old?.confirmed || before.confirmed ? before.status : null,
                after: p.status,
                note,
              },
            ],
          });
        }
        requests.set(key, JSON.stringify(p));
      }
    }
    if (
      ["period_attendance_save", "period_attendance_bulk"].includes(action) &&
      p.day === koreanDay(new Date())
    ) {
      const cutoff = new Date(
        `${p.day}T${[1, 2].includes(new Date(p.day + "T12:00:00+09:00").getUTCDay()) ? "16:30" : "15:30"}:00+09:00`,
      ).getTime();
      for (const entry of record.sessions
        .filter((s) =>
          action === "period_attendance_bulk"
            ? p.periods
              ? p.periods.includes(s.period)
              : s.period >= p.start_period && s.period <= p.end_period
            : s.period === p.period,
        )
        .flatMap((s) => s.entries.filter((e) => s.confirmed || e.confirmed))) {
        if (
          !["present", "late"].includes(entry.status) ||
          !state.students.some(
            (s) => s.id === entry.student_id && s.active && !s.deleted_at,
          ) ||
          state.visits.some(
            (v) =>
              v.student_id === entry.student_id &&
              (!v.exited_at || koreanDay(v.entered_at) === p.day),
          )
        )
          continue;
        const first =
          record.history
            .filter(
              (e) =>
                Array.isArray(e.changes) &&
                e.changes.some(
                  (c) =>
                    c.student_id === entry.student_id &&
                    ["present", "late"].includes(c.after || ""),
                ),
            )
            .map((e) => e.created_at)
            .sort()[0] || now();
        state.visits.unshift({
          id: id(),
          student_id: entry.student_id,
          entered_at: first,
          exited_at:
            Date.now() >= cutoff
              ? new Date(Math.max(cutoff, Date.parse(first))).toISOString()
              : null,
        });
      }
      save();
    }
    if (
      action !== "period_attendance" && teacher &&
      shouldSyncAttendance(p.day, record.sessions, operation)
    ) {
      record.sessions.forEach((s) => {
        s.synced_revision = s.revision;
        s.synced_at = now();
      });
      record.sheet_sync = { ok: true };
    } else if (action !== "period_attendance") {
      delete record.sheet_sync;
    }
    all[p.day] = record;
    localStorage.setItem("study-hall-period-attendance", JSON.stringify(all));
    const result = structuredClone(record);
    if (
      action !== "period_attendance" && teacher &&
      !shouldSyncAttendance(p.day, record.sessions, operation)
    )
      (result as any).sheet_deferred = true;
    if (!teacher) result.history = [];
    return result;
  }
  if (action === "menu_order") return structuredClone(menuConfig);
  if (action === "weekly_ranking") {
    const scope = p.scope || "week";
    if (!["day", "week", "previous_week"].includes(scope))
      throw Error("순위 조회 기간을 확인하세요.");
    const ranking = demoStudyRanking(
      state.students,
      state.visits,
      scope,
      Date.now(),
    );
    const collections = demoCollections(
      state.students,
      state.visits,
      Date.now(),
      Object.values(
        JSON.parse(
          localStorage.getItem("study-hall-period-attendance") || "{}",
        ),
      ).flatMap((d: any) => d.sessions),
      undefined,
      state.operating_days,
    );
    const collectedRanking = {
      ...ranking,
      rows: ranking.rows.map((r) => ({ ...r, collection: collections[r.id] })),
    };
    if (teacher || viewer) return collectedRanking;
    const r = collectedRanking.rows.find((r) => r.id === sid);
    const { rows, ...shared } = collectedRanking;
    return {
      ...shared,
      mine: r
        ? {
            rank: r.rank,
            seconds: r.seconds,
            tied: r.tied,
            tied_count: r.tied_count,
            leader_gap_seconds: r.leader_gap_seconds,
            collection: r.collection,
          }
        : null,
    };
  }
  if (action === "collection_history") {
    if (!["crowns", "stars", "clovers"].includes(p.kind))
      throw Error("수집 기록 종류를 확인하세요.");
    if (!teacher && !viewer && p.student_id && p.student_id !== sid)
      throw Error("본인 수집 기록만 조회할 수 있습니다.");
    const selected = teacher || viewer ? p.student_id : sid;
    if (
      !state.students.some(
        (s) => s.id === selected && s.active && !s.deleted_at,
      )
    )
      throw Error("학생을 확인하세요.");
    const records: DemoCollectionRecord[] = [];
    demoCollections(
      state.students,
      state.visits,
      Date.now(),
      Object.values(
        JSON.parse(
          localStorage.getItem("study-hall-period-attendance") || "{}",
        ),
      ).flatMap((d: any) => d.sessions),
      records,
      state.operating_days,
    );
    const matching = records
        .filter((r) => r.student_id === selected && r.kind === p.kind)
        .sort((a, b) => b.day.localeCompare(a.day)),
      offset = Math.max(0, p.offset || 0);
    return {
      kind: p.kind,
      total: matching.length,
      records: matching
        .slice(offset, offset + 50)
        .map(({ day, rank, seconds }) => ({ day, rank, seconds })),
    };
  }
  if (action === "cleaning") return structuredClone(cleaning);
  if (action === "cleaning_notice") return structuredClone(cleaningNotice);
  if (action === "supervision") {
    if (!teacher && !viewer) throw Error("교사 또는 관리자 권한이 필요합니다.");
    return structuredClone(supervision);
  }
  if (viewer && !["warning_issue", "warning_delete", "manual"].includes(action))
    throw Error("교사 권한으로 처리할 수 없는 요청입니다.");
  if (action === "suggest" && !teacher) {
    state.suggestions.unshift({
      id: id(),
      student_id: sid!,
      title: p.title,
      body: p.body,
      reply: "",
      status: "접수",
      created_at: now(),
      updated_at: now(),
    });
    save();
    return {};
  }
  if (action === "attendance" || (action === "manual" && (teacher || viewer))) {
    const staff = teacher || viewer;
    if (
      action === "manual" &&
      (!p.reason?.trim() || p.reason.trim().length > 500)
    )
      throw Error("수동 처리 사유를 입력하세요.");
    if (!["in", "out"].includes(p.direction))
      throw Error("입퇴실 구분을 확인하세요.");
    const studentId = staff ? p.student_id : sid;
    const student = state.students.find(
      (s) =>
        s.id === studentId &&
        !s.deleted_at &&
        (s.active || (staff && p.direction === "out")),
    );
    if (!student) throw Error("이용 가능한 학생이 아닙니다.");
    const key = (staff ? (viewer ? "viewer" : "teacher") : sid) + p.request_id;
    if (requests.has(key)) return requests.get(key);
    if (!staff && (!validQr(p.qr) || p.qr !== readQr().token))
      throw Error("QR이 만료되었거나 유효하지 않습니다.");
    const v = state.visits.find(
      (v) => v.student_id === studentId && !v.exited_at,
    );
    if (p.direction === "in") {
      const op = state.operating_days.find((d) => d.day === koreanDay(now()));
      if (
        op &&
        (op.is_closed ||
          Date.now() >= Date.parse(`${op.day}T${op.end_time}+09:00`))
      )
        throw Error("오늘 자습실 운영이 종료되어 입실할 수 없습니다.");
      if (v) throw Error("이미 입실 중입니다.");
      state.visits.unshift({
        id: id(),
        student_id: studentId!,
        entered_at: now(),
        exited_at: null,
      });
    } else {
      if (!v) throw Error("입실 기록이 없습니다.");
      v.exited_at = now();
    }
    requests.set(key, {});
    save();
    return {};
  }
  if (!teacher && !viewer) throw Error("교사 또는 관리자 권한이 필요합니다.");
  if (action === "warning_delete") {
    if (!p.reason?.trim() || p.reason.trim().length > 1000)
      throw Error("삭제 사유를 입력하세요.");
    const card = (state.warnings || []).find((w) => w.id === p.id);
    if (!card) throw Error("경고카드를 찾을 수 없습니다.");
    if (card.deleted_at) return {};
    state.audits.unshift({
      kind: "warning_delete",
      before_value: structuredClone(card),
      reason: p.reason.trim(),
      created_at: now(),
    });
    card.deleted_at = now();
    save();
    return {};
  }
  if (action === "warning_issue") {
    if (!p.reason?.trim() || p.reason.trim().length > 1000)
      throw Error("경고 사유를 입력하세요.");
    if (!state.students.some((s) => s.id === p.student_id && !s.deleted_at))
      throw Error("학생을 찾을 수 없습니다.");
    const warnings = (state.warnings ||= []);
    const existing = warnings.find((w) => w.id === p.request_id);
    if (existing) {
      if (
        existing.student_id !== p.student_id ||
        existing.reason !== p.reason.trim()
      )
        throw Error("이미 사용한 요청 번호입니다.");
      return existing;
    }
    const card = {
      id: p.request_id,
      student_id: p.student_id,
      reason: p.reason.trim(),
      created_at: now(),
    };
    warnings.unshift(card);
    save();
    return card;
  }
  if (!teacher) throw Error("관리자 권한이 필요합니다.");
  if (action === "menu_order_save") {
    if (p.revision !== menuConfig.revision)
      throw Error("다른 변경이 있습니다. 변경 취소 후 다시 수정하세요.");
    menuConfig = { orders: p.orders, revision: menuConfig.revision + 1 };
    localStorage.setItem(
      "study-hall-demo-menu-order",
      JSON.stringify(menuConfig),
    );
    return structuredClone(menuConfig);
  }
  if (action === "cleaning_notice_save") {
    if (p.revision !== cleaningNotice.revision)
      throw Error("다른 변경이 있습니다. 다시 조회하세요.");
    if (
      typeof p.body !== "string" ||
      !p.body.trim() ||
      p.body.trim().length > 3000
    )
      throw Error("안내 메시지는 1~3000자로 입력하세요.");
    cleaningNotice = {
      body: p.body.trim(),
      revision: cleaningNotice.revision + 1,
    };
    localStorage.setItem(
      "study-hall-fictional-cleaning-notice",
      JSON.stringify(cleaningNotice),
    );
    return structuredClone(cleaningNotice);
  }
  if (action === "cleaning_save") {
    const next = structuredClone(cleaning);
    for (const s of p.slots) {
      const i = next.findIndex((c) => c.day === s.day);
      if ((i < 0 ? 0 : next[i].revision) !== s.revision)
        throw Error("다른 변경이 있습니다. 다시 조회하세요.");
      const row = {
        day: s.day,
        note: s.note,
        revision: s.revision + 1,
        students: s.student_ids.map((id: string) => {
          const st = state.students.find(
            (st) => st.id === id && st.active && !st.deleted_at,
          );
          if (!st) throw Error("학생을 확인하세요.");
          return { id: st.id, name: st.name, number: st.number };
        }),
      };
      if (i < 0) next.push(row);
      else next[i] = row;
    }
    cleaning = next.sort((a, b) => a.day.localeCompare(b.day));
    localStorage.setItem(
      "study-hall-fictional-cleaning",
      JSON.stringify(cleaning),
    );
    return { saved: p.slots.length };
  }
  if (action === "cleaning_delete") {
    if (!cleaning.some((c) => c.day === p.day && c.revision === p.revision))
      throw Error("다른 변경이 있습니다. 다시 조회하세요.");
    cleaning = cleaning.filter((c) => c.day !== p.day);
    localStorage.setItem(
      "study-hall-fictional-cleaning",
      JSON.stringify(cleaning),
    );
    return {};
  }
  if (action === "supervision_save") {
    const draft = structuredClone(supervision);
    for (const slot of p.slots) {
      const index = draft.findIndex(
        (s) => s.day === slot.day && s.period === slot.period,
      );
      if (index < 0 || draft[index].revision !== slot.revision)
        throw Error("다른 변경이 있습니다. 다시 조회하세요.");
      if (slot.status === "assigned" && !slot.teacher_name?.trim())
        throw Error("감독 교사를 입력하세요.");
      draft[index] = { ...slot, revision: slot.revision + 1 };
    }
    supervision = draft;
    localStorage.setItem(
      "study-hall-fictional-supervision",
      JSON.stringify(supervision),
    );
    return { saved: p.slots.length };
  }
  if (action === "roster_import")
    throw Error("데모에서는 구글 출석부를 불러올 수 없습니다.");
  if (action === "sheet_sync_status")
    return {
      configured: true,
      endpoint: "",
      last_synced_at: localStorage.getItem("study-hall-demo-sheet-sync"),
    };
  if (action === "sheet_sync_setup")
    return { script: "// 데모에서는 실제 구글 시트에 연결하지 않습니다." };
  if (action === "sheet_sync_configure") return { configured: true };
  if (action === "sheet_sync") {
    const date = now();
    localStorage.setItem("study-hall-demo-sheet-sync", date);
    return { updated: 72, last_synced_at: date, demo: true };
  }
  if (action === "site_copy") {
    const copy = { ...readDemoCopy(), ...p.copy };
    if (
      Object.keys(copy).some((k) => !Object.hasOwn(defaultSiteCopy, k)) ||
      Object.keys(defaultSiteCopy).some(
        (k) => typeof copy[k] !== "string" || copy[k].length > 2000,
      )
    )
      throw Error("문구는 2000자 이내의 글자로 입력하세요.");
    localStorage.setItem("study-hall-demo-site-copy", JSON.stringify(copy));
    return copy;
  }
  if (action === "visits_delete") {
    if (!p.reason?.trim() || p.reason.length > 1000)
      throw Error("삭제 사유를 입력하세요.");
    if (
      !Array.isArray(p.ids) ||
      !p.ids.length ||
      p.ids.length > 1000 ||
      new Set(p.ids).size !== p.ids.length
    )
      throw Error("삭제할 기록을 1~1000건 선택하세요.");
    const records = state.visits.filter((v) => p.ids.includes(v.id));
    if (records.length !== p.ids.length)
      throw Error(
        "선택한 기록 중 이미 삭제되었거나 없는 기록이 있습니다. 다시 조회하세요.",
      );
    for (const record of records)
      state.audits.unshift({
        kind: "visit_delete_bulk",
        before_value: record,
        reason: p.reason.trim(),
        created_at: now(),
      });
    state.visits = state.visits.filter((v) => !p.ids.includes(v.id));
    save();
    return { deleted: records.length };
  }
  if (action === "visit_delete") {
    if (!String(p.reason || "").trim()) throw Error("삭제 사유를 입력하세요.");
    const vi = state.visits.find((v) => v.id === p.id);
    if (!vi) throw Error("출결 기록을 찾을 수 없습니다.");
    state.audits.unshift({
      kind: "visit_delete",
      before_value: vi,
      reason: p.reason,
      created_at: now(),
    });
    state.visits = state.visits.filter((v) => v.id !== p.id);
    save();
    return {};
  }
  if (action === "student_code") {
    const s = state.students.find(
      (s) => s.id === p.student_id && s.active && !s.deleted_at,
    );
    if (!s) throw Error("이용 가능한 학생이 아닙니다.");
    const found = [...codes].find(
      ([code, sid]) => sid === s.id && code.length === 5,
    );
    if (!found)
      throw Error("발급된 코드가 없습니다. 코드 발급을 먼저 실행하세요.");
    return { code: found[0] };
  }
  if (action === "student_delete") {
    const s = state.students.find((s) => s.id === p.id);
    if (!s) throw Error("학생을 찾을 수 없습니다.");
    if (state.visits.some((v) => v.student_id === s.id && !v.exited_at))
      throw Error("입실 중인 학생은 먼저 퇴실 처리하세요.");
    s.active = false;
    s.seat_id = null;
    s.deleted_at = now();
    for (const [key, value] of sessions)
      if (value === s.id) sessions.delete(key);
    for (const [key, value] of codes) if (value === s.id) codes.delete(key);
    save();
    return {};
  }
  if (action === "student_gender") {
    if (!["male", "female", "unknown"].includes(p.gender))
      throw Error("성별 값을 확인하세요.");
    for (const s of state.students)
      if (p.ids.includes(s.id)) s.gender = p.gender;
    save();
    return {};
  }
  if (action === "teacher_code" || action === "teacher_code_rotate") {
    if (action === "teacher_code_rotate") {
      localStorage.setItem("study-hall-demo-viewer-code", shortCode());
      for (const [key, value] of sessions)
        if (value === "viewer") sessions.delete(key);
    }
    return {
      code: localStorage.getItem("study-hall-demo-viewer-code") || "V7K2P",
    };
  }
  if (action === "qr" || action === "qr_rotate") {
    qr = readQr();
    if (qr.token && action === "qr") return qr;
    qr = {
      token:
        "SH1." +
        Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(""),
      fixed: true,
    };
    localStorage.setItem("study-hall-fictional-qr", JSON.stringify(qr));
    return qr;
  }
  if (action === "code") {
    const code = shortCode();
    for (const [key, value] of codes)
      if (value === p.student_id) codes.delete(key);
    codes.set(code, p.student_id);
    for (const [key, value] of sessions)
      if (value === p.student_id) sessions.delete(key);
    return { code };
  }
  if (action === "student") {
    if (
      p.gender !== undefined &&
      !["male", "female", "unknown"].includes(p.gender)
    )
      throw Error("성별 값을 확인하세요.");
    if (p.id) {
      const s = state.students.find((s) => s.id === p.id)!;
      if (s.deleted_at) throw Error("삭제된 학생은 수정할 수 없습니다.");
      Object.assign(s, p);
      if (!s.active)
        for (const [key, value] of sessions)
          if (value === s.id) sessions.delete(key);
    } else {
      if (
        state.students.filter((s) => s.active).length >= state.settings.capacity
      )
        throw Error("정원이 가득 찼습니다.");
      state.students.push({
        ...p,
        id: id(),
        active: true,
        seat_id: null,
      } as Student);
    }
  } else if (action === "settings") {
    if (p.capacity < state.students.filter((s) => s.active).length)
      throw Error("활동 학생 수보다 정원이 작습니다.");
    state.settings = p;
  } else if (action === "assign") {
    validateAssignments(state.students, state.seats, p.pairs);
    if (p.same_gender_pairs)
      validateDeskPairs(state.students, state.seats, p.pairs);
    const before = structuredClone(state.students);
    for (const pair of p.pairs)
      state.students.find((s) => s.id === pair.student_id)!.seat_id =
        pair.seat_id;
    state.audits.unshift({
      kind: "assign",
      before_value: before,
      after_value: p.pairs,
      reason: "좌석 배정 저장",
      created_at: now(),
    });
  } else if (action === "seat") {
    if (!p.enabled && state.students.some((s) => s.seat_id === p.id))
      throw Error("배정부터 해제하세요.");
    if (
      state.seats.some(
        (s) => s.id !== p.id && s.row === p.row && s.col === p.col,
      )
    )
      throw Error("위치가 겹칩니다.");
    const seat = state.seats.find((s) => s.id === p.id);
    if (seat) Object.assign(seat, p);
    else state.seats.push(p);
  } else if (action === "notice") {
    const n = state.notices.find((n) => n.id === p.id);
    if (n) Object.assign(n, p, { updated_at: now() });
    else
      state.notices.unshift({
        ...p,
        id: id(),
        created_at: now(),
        updated_at: now(),
      });
  } else if (action === "notice_delete")
    state.notices = state.notices.filter((n) => n.id !== p.id);
  else if (action === "reply")
    Object.assign(
      state.suggestions.find((s) => s.id === p.id)!,
      p,
      { updated_at: now() },
    );
  else if (action === "correct") {
    const v = state.visits.find((v) => v.id === p.id)!;
    if (
      !p.reason.trim() ||
      (p.exited_at && Date.parse(p.exited_at) < Date.parse(p.entered_at))
    )
      throw Error("시각과 수정 사유를 확인하세요.");
    if (
      !p.exited_at &&
      state.visits.some(
        (x) => x.id !== v.id && x.student_id === v.student_id && !x.exited_at,
      )
    )
      throw Error("입실 중인 기록이 이미 있습니다.");
    const before = structuredClone(v);
    v.entered_at = p.entered_at;
    v.exited_at = p.exited_at || null;
    state.audits.unshift({
      kind: "correct",
      before_value: before,
      after_value: structuredClone(v),
      reason: p.reason,
      created_at: now(),
      actor: "demo-teacher",
    });
  } else if (action === "operating_day") {
    state.operating_days = state.operating_days.filter((d) => d.day !== p.day);
    if (p.end_time <= p.start_time) throw Error("운영 종료 시각을 확인하세요.");
    state.operating_days.push(p);
    const cutoff = Date.parse(
      `${p.day}T${p.is_closed ? "00:00" : p.end_time}+09:00`,
    );
    if (p.day === koreanDay(now()) && Date.now() >= cutoff) {
      state.visits = state.visits.map((v) =>
        Date.parse(v.entered_at) <= Date.now() &&
        (!v.exited_at ||
          (koreanDay(v.entered_at) === p.day &&
            Date.parse(v.exited_at) >
              Math.max(cutoff, Date.parse(v.entered_at))))
          ? {
              ...v,
              exited_at: new Date(
                Math.max(cutoff, Date.parse(v.entered_at)),
              ).toISOString(),
            }
          : v,
      );
    }
  } else throw Error("지원하지 않는 요청");
  save();
  return {};
}
export const demoQr = () => readQr();
