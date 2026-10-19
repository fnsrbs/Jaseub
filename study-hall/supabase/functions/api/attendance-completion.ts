type Session = { period: number; confirmed: boolean; synced_revision?: number };
export function scheduledPeriodCount(day: string) {
  const weekday = new Date(`${day}T12:00:00+09:00`).getUTCDay();
  return weekday >= 1 && weekday <= 5 ? (weekday <= 2 ? 7 : 6) : 0;
}
export function missingAttendancePeriods(day: string, sessions: Session[]) {
  return Array.from(
    { length: scheduledPeriodCount(day) },
    (_, i) => i + 1,
  ).filter(
    (period) =>
      !sessions.some((s) => s.period === period && s.confirmed === true),
  );
}
export function shouldSyncAttendance(day: string, sessions: Session[]) {
  return (
    scheduledPeriodCount(day) > 0 &&
    missingAttendancePeriods(day, sessions).length === 0
  );
}
