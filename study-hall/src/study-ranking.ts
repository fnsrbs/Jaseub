import {
  dayStart,
  koreanDay,
  totals,
  type Student,
  type Visit,
} from "./domain";
export function rankingTime(seconds: number) {
  const n = Math.max(0, Math.floor(seconds)),
    h = Math.floor(n / 3600),
    m = Math.floor((n % 3600) / 60),
    s = n % 60;
  return `${h ? `${h}시간 ` : ""}${m || h || !s ? `${m}분` : ""}${s ? `${m || h ? " " : ""}${s}초` : ""}`;
}
export function demoStudyRanking(
  students: Student[],
  visits: Visit[],
  scope: "day" | "week",
  now: number,
) {
  const today = koreanDay(new Date(now)),
    weekday = new Date(dayStart(today) + 9 * 3600000).getUTCDay();
  const monday = koreanDay(
    new Date(dayStart(today) - ((weekday + 6) % 7) * 86400000),
  );
  const rows = students
    .filter((s) => s.active && !s.deleted_at)
    .map((s) => {
      const t = totals(
        visits.filter(
          (v) =>
            v.student_id === s.id &&
            v.exited_at &&
            Date.parse(v.exited_at) <= now,
        ),
        now,
      );
      return {
        id: s.id,
        name: s.name,
        number: s.number,
        seconds: Math.floor(scope === "day" ? t.today : t.week),
      };
    })
    .sort(
      (a, b) =>
        b.seconds - a.seconds ||
        a.number.localeCompare(b.number, "ko", { numeric: true }),
    );
  const leader = rows[0]?.seconds || 0;
  return {
    scope,
    period_start: scope === "day" ? today : monday,
    period_end:
      scope === "day"
        ? today
        : koreanDay(new Date(dayStart(monday) + 4 * 86400000)),
    participants: rows.filter((r) => r.seconds > 0).length,
    eligible: rows.length,
    average_seconds: Math.floor(
      rows.filter((r) => r.seconds > 0).reduce((sum, r) => sum + r.seconds, 0) /
        Math.max(1, rows.filter((r) => r.seconds > 0).length),
    ),
    rows: rows.map((r) => {
      const tied_count =
        r.seconds > 0 ? rows.filter((x) => x.seconds === r.seconds).length : 0;
      return {
        ...r,
        rank:
          r.seconds > 0
            ? rows.findIndex((x) => x.seconds === r.seconds) + 1
            : null,
        tied: tied_count > 1,
        tied_count,
        leader_gap_seconds: r.seconds > 0 ? leader - r.seconds : null,
      };
    }),
  };
}
