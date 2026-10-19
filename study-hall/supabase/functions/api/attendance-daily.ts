export const dailyLabels = {
  present: "출석",
  late: "지각",
  missed: "결과",
  early: "조퇴",
  absent: "결석",
  excused: "인정결석",
} as const;
type Entry = {
  period: number;
  status: string;
  note?: string;
  exempt_reason?: string;
};
export type DailySource = {
  day: string;
  student_id: string;
  entries: Entry[];
  last_exit?: string | null;
};
const countFor = (day: string) => {
  const n = new Date(day + "T12:00:00+09:00").getUTCDay();
  return n === 0 || n === 6 ? 0 : n <= 2 ? 7 : 6;
};
const cutoffFor = (day: string) =>
  Date.parse(
    day + (countFor(day) === 7 ? "T16:30:00+09:00" : "T15:30:00+09:00"),
  );
const ends = ["09:40", "10:40", "11:40", "12:40", "14:30", "15:30", "16:30"];
export function summarizeDaily(
  source: DailySource[],
  payload: any,
  now = Date.now(),
) {
  const summaries = new Map<string, any>(),
    records: any[] = [];
  const fresh = (id: string) => ({
    student_id: id,
    present: 0,
    late: 0,
    missed: 0,
    early: 0,
    absent: 0,
    excused: 0,
    irregular_days: 0,
    equivalent_absent: 0,
    lifetime_absent: 0,
    lifetime_irregular: 0,
    lifetime_equivalent: 0,
    removal_candidate: false,
    pending_days: 0,
  });
  for (const day of source) {
    if (payload.student_id && day.student_id !== payload.student_id) continue;
    const count = countFor(day.day);
    if (!count || now < cutoffFor(day.day)) continue;
    const c = summaries.get(day.student_id) || fresh(day.student_id);
    summaries.set(day.student_id, c);
    const inRange = day.day >= payload.start && day.day <= payload.end;
    const entries = [...day.entries].sort((a, b) => a.period - b.period);
    if (
      new Set(entries.map((e) => e.period)).size !== count ||
      entries.some((e) => e.period < 1 || e.period > count)
    ) {
      if (inRange) c.pending_days++;
      continue;
    }
    const positive = entries.filter(
      (e) => e.status === "present" || e.status === "late",
    );
    const first = positive[0]?.period,
      last = positive.at(-1)?.period;
    const exempt = (e: Entry) =>
      e.status === "excused" && !!e.exempt_reason?.trim();
    const negative = entries.filter(
      (e) => !exempt(e) && (e.status === "absent" || e.status === "excused"),
    );
    const allAbsent = !positive.length && negative.length > 0;
    const exit = day.last_exit ? Date.parse(day.last_exit) : NaN;
    const earlyExit =
      positive.length > 0 &&
      exit < cutoffFor(day.day) &&
      exit >= Date.parse(day.day + "T00:00:00+09:00");
    const details = entries.flatMap((e) => {
      let status = e.status;
      if (
        !exempt(e) &&
        (status === "absent" || status === "excused") &&
        !allAbsent
      ) {
        status =
          earlyExit &&
          exit < Date.parse(day.day + "T" + ends[e.period - 1] + ":00+09:00")
            ? "early"
            : first !== undefined && e.period < first
              ? "late"
              : last !== undefined && e.period > last
                ? "early"
                : "missed";
      } else if (
        earlyExit &&
        !exempt(e) &&
        (status === "present" || status === "late") &&
        exit < Date.parse(day.day + "T" + ends[e.period - 1] + ":00+09:00")
      ) {
        status = "early";
      }
      return status === "present"
        ? []
        : [
            {
              day: day.day,
              period: e.period,
              status,
              original_status: e.status,
              note: e.note || "",
              exempt_reason: exempt(e) ? e.exempt_reason : "",
              exit_at:
                status === "early" && earlyExit ? day.last_exit : undefined,
            },
          ];
    });
    const irregular =
      !allAbsent &&
      details.some(
        (e) =>
          !e.exempt_reason && ["late", "early", "missed"].includes(e.status),
      );
    if (allAbsent) c.lifetime_absent++;
    if (irregular) c.lifetime_irregular++;
    if (!inRange) continue;
    if (allAbsent) {
      c.absent++;
      if (negative.length === count)
        records.push({
          day: day.day,
          period: null,
          status: "absent",
          note: [...new Set(negative.map((e) => e.note).filter(Boolean))].join(
            " / ",
          ),
          all_day: true,
        });
      else records.push(...details);
    } else {
      if (irregular) {
        c.irregular_days++;
        // One date has one daily category; the detail list retains every affected period.
        c[
          details.some((e) => !e.exempt_reason && e.status === "early")
            ? "early"
            : details.some((e) => !e.exempt_reason && e.status === "missed")
              ? "missed"
              : "late"
        ]++;
      } else if (entries.some(exempt)) c.excused++;
      else c.present++;
      records.push(...details);
    }
  }
  for (const c of summaries.values()) {
    c.equivalent_absent = c.absent + Math.floor(c.irregular_days / 3);
    c.lifetime_equivalent =
      c.lifetime_absent + Math.floor(c.lifetime_irregular / 3);
    c.removal_candidate = c.lifetime_equivalent >= 3;
  }
  records.sort(
    (a, b) => b.day.localeCompare(a.day) || (a.period ?? 0) - (b.period ?? 0),
  );
  const offset = Math.max(0, Number(payload.offset) || 0);
  return {
    summaries: [...summaries.values()],
    total: payload.student_id ? records.length : 0,
    records: payload.student_id ? records.slice(offset, offset + 100) : [],
  };
}
