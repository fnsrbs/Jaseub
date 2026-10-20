type Session = { period: number; confirmed: boolean; synced_revision?: number };
export type OperatingPolicy = { end_time: string; student_ids?: string[] };
export function scheduledPeriodCount(
  day: string,
  operation?: OperatingPolicy | null,
) {
  const weekday = new Date(`${day}T12:00:00+09:00`).getUTCDay();
  const max = weekday >= 1 && weekday <= 5 ? (weekday <= 2 ? 7 : 6) : 0;
  if (operation?.student_ids?.length === 0) return 0;
  return operation
    ? ["08:50", "09:50", "10:50", "11:50", "13:40", "14:40", "15:40"]
        .slice(0, max)
        .filter((t) => t < operation.end_time.slice(0, 5)).length
    : max;
}
export function missingAttendancePeriods(
  day: string,
  sessions: Session[],
  operation?: OperatingPolicy | null,
) {
  return Array.from(
    { length: scheduledPeriodCount(day, operation) },
    (_, i) => i + 1,
  ).filter(
    (period) =>
      !sessions.some((s) => s.period === period && s.confirmed === true),
  );
}
export function shouldSyncAttendance(
  day: string,
  sessions: Session[],
  operation?: OperatingPolicy | null,
) {
  return (
    scheduledPeriodCount(day, operation) > 0 &&
    missingAttendancePeriods(day, sessions, operation).length === 0
  );
}
