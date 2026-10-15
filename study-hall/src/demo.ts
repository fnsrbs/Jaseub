import {
  koreanDay,
  validateAssignments,
  validQr,
  type Snapshot,
  type Student,
  type SupervisionSlot,
} from "./domain";
import { validateDeskPairs } from "./seat-pairs";
const now = () => new Date().toISOString();
import { classroomSeats } from "./seat-layout";
import { defaultSiteCopy } from "./site-copy";
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
  save();
}
export async function demoApi(
  action: string,
  p: any,
  role: "student" | "teacher" | "viewer" | null,
  session: string | null,
): Promise<any> {
  if (action === "public_copy") {
    try {
      return (
        JSON.parse(
          localStorage.getItem("study-hall-demo-site-copy") || "null",
        ) || defaultSiteCopy
      );
    } catch {
      return defaultSiteCopy;
    }
  }
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
  if (action === "supervision") {
    if (!teacher && !viewer) throw Error("교사 또는 관리자 권한이 필요합니다.");
    return structuredClone(supervision);
  }
  if (viewer && !["warning_issue", "warning_delete"].includes(action))
    throw Error("교사는 조회 및 경고카드 관리만 가능합니다.");
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
  if (action === "attendance" || (action === "manual" && teacher)) {
    const studentId = teacher ? p.student_id : sid;
    const student = state.students.find(
      (s) =>
        s.id === studentId && (s.active || (teacher && p.direction === "out")),
    );
    if (!student) throw Error("이용 가능한 학생이 아닙니다.");
    const key = (teacher ? "teacher" : sid) + p.request_id;
    if (requests.has(key)) return requests.get(key);
    if (!teacher && (!validQr(p.qr) || p.qr !== readQr().token))
      throw Error("QR이 만료되었거나 유효하지 않습니다.");
    const v = state.visits.find(
      (v) => v.student_id === studentId && !v.exited_at,
    );
    if (p.direction === "in") {
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
  if (action === "site_copy") {
    localStorage.setItem("study-hall-demo-site-copy", JSON.stringify(p.copy));
    return p.copy;
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
      reason: "좌석 배정 확정",
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
    state.operating_days.push(p);
  } else throw Error("지원하지 않는 요청");
  save();
  return {};
}
export const demoQr = () => readQr();
