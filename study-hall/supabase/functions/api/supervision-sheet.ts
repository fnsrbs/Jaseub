type Slot = {
  day: string;
  period: number;
  week_label: string;
  teacher_name: string;
  status: string;
  note: string;
  revision: number;
};

// The Google sheet has a week label, a date header, then seven period rows.
export function supervisionSheetSlots(
  input: unknown,
  existing: Slot[],
): Slot[] {
  if (
    !Array.isArray(input) ||
    input.length > 500 ||
    input.some((r) => !Array.isArray(r))
  )
    throw Error("구글 감독표 형식을 확인하세요.");
  const rows = input as unknown[][];
  const slots: Slot[] = [],
    seen = new Set<string>();
  let week = "";
  for (let r = 0; r < rows.length; r++) {
    const first = String(rows[r][0] ?? "").trim();
    if (/^\d+주차/.test(first)) week = first;
    if (first !== "교시") continue;
    if (!week || week.length > 150) throw Error("감독표 주차를 확인하세요.");
    let dates = 0;
    for (let c = 1; c < Math.min(rows[r].length, 7); c++) {
      const raw = rows[r][c];
      if (raw === null || raw === undefined || raw === "") continue;
      const day =
        typeof raw === "number"
          ? new Date(Date.UTC(1899, 11, 30) + raw * 86400000)
              .toISOString()
              .slice(0, 10)
          : String(raw).trim();
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
        !Number.isFinite(Date.parse(day)) ||
        new Date(day).toISOString().slice(0, 10) !== day
      )
        throw Error("감독표 날짜 셀을 날짜 형식으로 입력하세요.");
      dates++;
      for (let p = 1; p <= 7; p++) {
        if (Number(rows[r + p]?.[0]) !== p)
          throw Error("감독표 1~7교시 행을 확인하세요.");
        const key = `${day}:${p}`;
        if (seen.has(key)) throw Error("감독표 날짜·교시가 중복되었습니다.");
        seen.add(key);
        const text = String(rows[r + p][c] ?? "").trim();
        const old = existing.find((s) => s.day === day && s.period === p);
        const closed = /^(?:[×xX✕✖-]|운영\s*없음|미운영)$/.test(text);
        const event =
          /고사|학습|행사|동아리|수능|휴업|공휴|재량/.test(text) ||
          (old?.status === "event" && old.note === text);
        const status =
          !text || text === "미배정"
            ? "unassigned"
            : closed
              ? "closed"
              : event
                ? "event"
                : "assigned";
        const changed =
          !!old &&
          (old.status !== status ||
            old.teacher_name !== (status === "assigned" ? text : "") ||
            old.week_label !== week);
        if (text.length > (status === "assigned" ? 80 : 500))
          throw Error("감독표 이름·행사명이 너무 깁니다.");
        slots.push({
          day,
          period: p,
          week_label: week,
          status,
          teacher_name: status === "assigned" ? text : "",
          note:
            status === "event"
              ? text
              : old?.note?.trim()
                ? old.note
                : changed
                  ? "교환"
                  : "",
          revision: old?.revision || 0,
        });
      }
    }
    if (!dates) throw Error("감독표 날짜가 없습니다.");
  }
  if (!slots.length)
    throw Error(
      "구글 감독표에서 배정을 찾지 못했습니다. 감독표 시트의 주차·교시·날짜를 확인하세요.",
    );
  if (existing.some((s) => !seen.has(`${s.day}:${s.period}`)))
    throw Error(
      "기존 날짜·교시가 구글 감독표에서 누락되었습니다. 시트 구조를 확인하세요.",
    );
  return slots.filter((s) => {
    const old = existing.find((o) => o.day === s.day && o.period === s.period);
    return (
      !old ||
      ["week_label", "status", "teacher_name", "note"].some(
        (k) => old[k as keyof Slot] !== s[k as keyof Slot],
      )
    );
  });
}
