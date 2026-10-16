import {
  dayStart,
  koreanDay,
  totals,
  type Student,
  type Visit,
} from "./domain";
import type { AttendanceSession } from "./period-attendance";
export type DemoCollectionRecord = {
  student_id: string;
  day: string;
  kind: "crowns" | "stars" | "clovers";
  rank: number | null;
  seconds: number | null;
};
export function demoCollections(
  students: Student[],
  visits: Visit[],
  now: number,
  sessions: AttendanceSession[] = [],
  records?: DemoCollectionRecord[],
) {
  const eligible = students.filter((s) => s.active && !s.deleted_at);
  const result: Record<
    string,
    { crowns: number; stars: number; clovers: number }
  > = {};
  const days = new Map<string, Map<string, number>>();
  for (const s of eligible) {
    const attended = new Set(
      visits
        .filter((v) => v.student_id === s.id && Date.parse(v.entered_at) <= now)
        .map((v) => koreanDay(v.entered_at)),
    );
    for (const session of sessions)
      if (
        session.confirmed &&
        session.day <= koreanDay(new Date(now)) &&
        session.entries.some(
          (e) =>
            e.student_id === s.id && ["present", "late"].includes(e.status),
        )
      )
        attended.add(session.day);
    result[s.id] = { crowns: 0, stars: 0, clovers: attended.size };
    for (const day of attended)
      records?.push({
        student_id: s.id,
        day,
        kind: "clovers",
        rank: null,
        seconds: null,
      });
    for (const v of visits.filter(
      (v) =>
        v.student_id === s.id && v.exited_at && Date.parse(v.exited_at) <= now,
    )) {
      const end = Date.parse(v.exited_at!);
      for (let t = Date.parse(v.entered_at); t < end;) {
        const day = koreanDay(new Date(t)),
          start = dayStart(day),
          next = Math.min(end, start + 86400000),
          weekday = new Date(start + 9 * 3600000).getUTCDay();
        const cutoff = Date.parse(
          day + (weekday <= 2 ? "T16:30:00+09:00" : "T15:30:00+09:00"),
        );
        if (
          weekday >= 1 &&
          weekday <= 5 &&
          now >= cutoff &&
          !visits.some(
            (o) =>
              !o.exited_at &&
              resultEligible(o.student_id) &&
              Date.parse(o.entered_at) < start + 86400000,
          )
        ) {
          const scores = days.get(day) ?? new Map<string, number>();
          scores.set(s.id, (scores.get(s.id) ?? 0) + (next - t) / 1000);
          days.set(day, scores);
        }
        t = next;
      }
    }
  }
  function resultEligible(id: string) {
    return eligible.some((s) => s.id === id);
  }
  for (const [day, scores] of days.entries()) {
    const values = [...scores]
      .map(([id, seconds]) => ({ id, seconds: Math.floor(seconds) }))
      .filter((x) => x.seconds > 0)
      .sort((a, b) => b.seconds - a.seconds);
    for (const x of values) {
      const rank = values.findIndex((v) => v.seconds === x.seconds) + 1;
      if (rank === 1) result[x.id].crowns++;
      else if (rank <= 5) result[x.id].stars++;
      if (rank <= 5)
        records?.push({
          student_id: x.id,
          day,
          kind: rank === 1 ? "crowns" : "stars",
          rank,
          seconds: x.seconds,
        });
    }
  }
  return result;
}
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
