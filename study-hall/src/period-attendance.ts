import {
  scheduledPeriodCount,
  type OperatingPolicy,
} from "../supabase/functions/api/attendance-completion";
import {
  koreanDay,
  type OperatingDay,
  type Student,
  type Visit,
} from "./domain";
export const periodTimes = [
  ["08:50", "09:40"],
  ["09:50", "10:40"],
  ["10:50", "11:40"],
  ["11:50", "12:40"],
  ["13:40", "14:30"],
  ["14:40", "15:30"],
  ["15:40", "16:30"],
] as const;
export const attendanceLabels = {
  present: "출석",
  late: "지각",
  absent: "결석",
  excused: "인정결석",
} as const;
export type AttendanceStatus = keyof typeof attendanceLabels;
export type AttendanceEntry = {
  confirmed?: boolean;
  exempt_reason?: string;
  student_id: string;
  number: string;
  name: string;
  seat_id: number | null;
  status: AttendanceStatus;
  note: string;
};
export type AttendanceSession = {
  day: string;
  period: number;
  entries: AttendanceEntry[];
  confirmed: boolean;
  revision: number;
  updated_at: string;
  updated_by: string;
  synced_revision: number;
  synced_at: string | null;
  request_id?: string;
  change_id?: number;
};
export type AttendanceHistory = {
  id: number;
  day: string;
  period: number;
  actor: string;
  action: string;
  reason: string;
  created_at: string;
  changes:
    | {
        student_id?: string;
        number?: string;
        name?: string;
        before?: AttendanceStatus | null;
        after?: AttendanceStatus;
        note?: string;
        exempt_reason?: string;
      }[]
    | { previous_revision: number };
};
export type AttendanceDay = {
  operating_day?: OperatingDay | null;
  sheet_deferred?: boolean;
  day: string;
  sessions: AttendanceSession[];
  history: AttendanceHistory[];
  sheet_configured: boolean;
  sheet_sync?: { ok: boolean; error?: string; url?: string };
};
export function periodsForDay(day: string, operation?: OperatingPolicy | null) {
  return scheduledPeriodCount(day, operation);
}
export function periodAt(now: number, operation?: OperatingPolicy | null) {
  const day = koreanDay(new Date(now));
  const count = periodsForDay(day, operation);
  if (!count) return { period: 1, label: "수업 없는 날" };
  const minutes =
    new Date(now + 9 * 3600000).getUTCHours() * 60 +
    new Date(now + 9 * 3600000).getUTCMinutes();
  const value = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  let period = 1;
  for (let i = 0; i < count; i++)
    if (minutes >= value(periodTimes[i][0])) period = i + 1;
  const [start, end] = periodTimes[period - 1];
  return {
    period,
    label:
      minutes < value(start)
        ? "수업 시작 전"
        : minutes < value(end)
          ? "수업 중"
          : period === count
            ? "오늘 수업 종료"
            : period === 4
              ? "점심시간"
              : "쉬는 시간",
  };
}
export function attendancePreview(
  entries: AttendanceEntry[],
  visits?: Visit[],
): AttendanceEntry[] {
  const inside = visits
    ? new Set(visits.filter((v) => !v.exited_at).map((v) => v.student_id))
    : null;
  return entries.map((e) => ({
    ...e,
    ...(e.confirmed
      ? { status: e.status, note: e.note }
      : {
          status: inside && !inside.has(e.student_id) ? "absent" : "present",
          note: "",
        }),
  }));
}
export function defaultAttendance(
  students: Student[],
  visits?: Visit[],
): AttendanceEntry[] {
  return attendancePreview(
    students
      .filter((s) => s.active && !s.deleted_at)
      .sort((a, b) => a.number.localeCompare(b.number, "ko", { numeric: true }))
      .map((s) => ({
        student_id: s.id,
        name: s.name,
        number: s.number,
        seat_id: s.seat_id,
        status: "present",
        note: "",
      })),
    visits,
  );
}

export function manualAttendancePreview(
  entries: AttendanceEntry[],
): AttendanceEntry[] {
  return entries.map((entry) =>
    entry.confirmed
      ? { ...entry }
      : { ...entry, status: "present", note: "", exempt_reason: "" },
  );
}
