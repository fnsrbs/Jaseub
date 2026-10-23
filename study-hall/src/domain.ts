import { scheduledPeriodCount } from "../supabase/functions/api/attendance-completion";
export type Student = {
  participation_stopped?: boolean;
  id: string;
  name: string;
  number: string;
  active: boolean;
  gender?: "male" | "female" | "unknown";
  deleted_at?: string | null;
  seat_id: number | null;
};
export type Seat = { id: number; row: number; col: number; enabled: boolean };
export type Visit = {
  id: string;
  student_id: string;
  entered_at: string;
  exited_at: string | null;
};
export type Notice = {
  id: string;
  title: string;
  body: string;
  important: boolean;
  created_at: string;
  updated_at: string;
};
export type Suggestion = {
  id: string;
  student_id: string;
  title: string;
  body: string;
  reply: string;
  status: string;
  created_at: string;
  updated_at: string;
};
export type Settings = {
  site_copy?: Record<string, string>;
  capacity: number;
  exam_date: string | null;
  missing_hours: number;
};
export type OperatingDay = {
  is_closed?: boolean;
  day: string;
  start_time: string;
  end_time: string;
  student_ids: string[];
};
export type Snapshot = {
  clovers?: number;
  warnings?: {
    id: string;
    student_id: string;
    reason: string;
    created_at: string;
    deleted_at?: string | null;
  }[];
  students: Student[];
  seats: Seat[];
  visits: Visit[];
  notices: Notice[];
  suggestions: Suggestion[];
  settings: Settings;
  operating_days: OperatingDay[];
  current: number;
  today: number;
  server_now: string;
  audits: Record<string, unknown>[];
};
export const koreanDay = (value: Date | string) =>
  new Date(new Date(value).getTime() + 9 * 3600000).toISOString().slice(0, 10);
export const dayStart = (day: string) => Date.parse(`${day}T00:00:00+09:00`);
export const csvTime = (value: string | null) =>
  value
    ? new Date(Date.parse(value) + 9 * 3600000)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ")
    : "";
export const duration = (seconds: number) =>
  `${Math.floor(seconds / 3600)}시간 ${Math.floor((seconds % 3600) / 60)}분`;
export function dailyUsage(
  visits: Visit[],
  now = Date.now(),
  missingHours = 16,
) {
  const days: Record<
    string,
    { confirmed: number; ongoing: number; review: number }
  > = {};
  for (const v of visits) {
    const start = Date.parse(v.entered_at),
      end = v.exited_at ? Date.parse(v.exited_at) : now;
    if (!Number.isFinite(start) || end < start) continue;
    const review = !v.exited_at && end - start > missingHours * 3600000;
    // Suspected missing checkouts never accrue unbounded provisional time.
    const capped = review ? Math.min(end, start + missingHours * 3600000) : end;
    for (let t = start; t < capped;) {
      const day = koreanDay(new Date(t));
      const next = Math.min(capped, dayStart(day) + 86400000);
      const d = (days[day] ??= { confirmed: 0, ongoing: 0, review: 0 });
      if (review) d.review++;
      else d[v.exited_at ? "confirmed" : "ongoing"] += (next - t) / 1000;
      t = next;
    }
  }
  return days;
}
export function totals(visits: Visit[], now = Date.now(), missingHours = 16) {
  const days = dailyUsage(visits, now, missingHours),
    today = koreanDay(new Date(now));
  const wd = new Date(dayStart(today) + 9 * 3600000).getUTCDay();
  const monday = koreanDay(
    new Date(dayStart(today) - ((wd + 6) % 7) * 86400000),
  );
  const friday = koreanDay(new Date(dayStart(monday) + 4 * 86400000));
  const entries = Object.entries(days);
  const sum = (test: (d: string) => boolean) =>
    entries.filter(([d]) => test(d)).reduce((a, [, v]) => a + v.confirmed, 0);
  return {
    days,
    today: sum((d) => d === today),
    week: sum((d) => d >= monday && d <= friday && d <= today),
    month: sum((d) => d.slice(0, 7) === today.slice(0, 7)),
    all: sum(() => true),
    count: entries.filter(([, v]) => v.confirmed > 0).length,
  };
}
export function attendanceVerdict(
  studentId: string,
  day: OperatingDay | undefined,
  visits: Visit[],
  now: number,
) {
  if (!day || !day.student_ids.includes(studentId)) return "출석 확인 전";
  if (scheduledPeriodCount(day.day, day) === 0) return "교시별 출석 확인 제외";
  const first = visits
    .filter(
      (v) => v.student_id === studentId && koreanDay(v.entered_at) === day.day,
    )
    .sort((a, b) => a.entered_at.localeCompare(b.entered_at))[0];
  if (first)
    return Date.parse(first.entered_at) >
      Date.parse(`${day.day}T${day.start_time}+09:00`)
      ? "지각"
      : "출석";
  return now >= Date.parse(`${day.day}T${day.end_time}+09:00`)
    ? "결석"
    : "입실 전";
}
export function validateAssignments(
  students: Student[],
  seats: Seat[],
  pairs: { student_id: string; seat_id: number | null }[],
) {
  const ids = new Set<string>(),
    used = new Set<number>();
  for (const p of pairs) {
    if (ids.has(p.student_id) || !students.some((s) => s.id === p.student_id))
      throw Error("학생 선택을 확인하세요.");
    ids.add(p.student_id);
    if (p.seat_id !== null) {
      if (
        used.has(p.seat_id) ||
        !seats.some((s) => s.id === p.seat_id && s.enabled)
      )
        throw Error("좌석이 중복되거나 사용할 수 없습니다.");
      used.add(p.seat_id);
    }
  }
  for (const s of students) {
    if (!ids.has(s.id) && s.seat_id !== null && used.has(s.seat_id))
      throw Error("선택하지 않은 학생의 좌석과 겹칩니다.");
  }
  return pairs;
}
export function lottery(
  students: Student[],
  seats: Seat[],
  selected: string[],
  available: number[],
  fixed: string[],
  random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296,
) {
  const reserved = new Set(
    students
      .filter((s) => !selected.includes(s.id) || fixed.includes(s.id))
      .map((s) => s.seat_id)
      .filter((x): x is number => x !== null),
  );
  const pool = seats
    .filter((s) => s.enabled && available.includes(s.id) && !reserved.has(s.id))
    .map((s) => s.id);
  const movable = students.filter(
    (s) => selected.includes(s.id) && !fixed.includes(s.id),
  );
  if (pool.length < movable.length)
    throw Error(
      `사용 가능한 좌석이 ${movable.length - pool.length}석 부족합니다.`,
    );
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return validateAssignments(
    students,
    seats,
    students
      .filter((s) => selected.includes(s.id))
      .map((s) => ({
        student_id: s.id,
        seat_id: fixed.includes(s.id)
          ? s.seat_id
          : pool[movable.findIndex((m) => m.id === s.id)],
      })),
  );
}
export const validQr = (token: string) => /^SH1\.[a-f0-9]{64}$/.test(token);
export function csv(rows: unknown[][]) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            let s = String(value ?? "");
            if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n")
  );
}

export type SupervisionSlot = {
  day: string;
  period: number;
  week_label: string;
  teacher_name: string;
  status: "assigned" | "closed" | "event" | "unassigned";
  note: string;
  revision: number;
};
