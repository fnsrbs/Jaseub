import { koreanDay, totals, type Visit } from "./domain";

// The final study-room day, in Korea. Keep the letter available afterwards.
export const farewellDay = "2026-11-17";
export function farewellVisibility(now: number) {
  const day = koreanDay(new Date(now));
  return { available: day >= farewellDay, autoOpen: day === farewellDay };
}

export function farewellRecord(
  visits: Visit[],
  studentId: string,
  now: number,
  missingHours: number,
) {
  const record = totals(
    visits.filter((visit) => visit.student_id === studentId),
    now,
    missingHours,
  );
  return { seconds: record.all, days: record.count };
}
