import { koreanDay, totals, type Visit } from "./domain";
import { readFarewellCopy } from "./farewell-copy";

export function farewellVisibility(now: number, copy?: Record<string, string>) {
  const config = readFarewellCopy(copy);
  const day = koreanDay(new Date(now));
  return {
    available:
      config.farewell_enabled === "true" && day >= config.farewell_date,
    autoOpen:
      config.farewell_enabled === "true" && day === config.farewell_date,
  };
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
