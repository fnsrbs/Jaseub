import type { Student } from "./domain";
export type CleaningSlot = {
  day: string;
  note: string;
  revision: number;
  students: Pick<Student, "id" | "name" | "number">[];
};
export function cleaningPlan(
  students: Student[],
  start: string,
  weeks: number,
  weekdays: number[],
): CleaningSlot[] {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
    !Number.isInteger(weeks) ||
    weeks < 1 ||
    weeks > 6 ||
    new Set(weekdays).size !== 2 ||
    weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  )
    throw Error("시작일과 주 2회 청소 요일을 선택하세요.");
  const date = new Date(`${start}T12:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== start
  )
    throw Error("시작일을 확인하세요.");
  const members = students
    .filter((s) => s.active && !s.deleted_at)
    .sort(
      (a, b) =>
        a.number.localeCompare(b.number, "ko", { numeric: true }) ||
        a.name.localeCompare(b.name, "ko"),
    );
  if (!members.length) throw Error("청소를 배정할 학생이 없습니다.");
  const days: string[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    if (weekdays.includes(date.getUTCDay()))
      days.push(date.toISOString().slice(0, 10));
    date.setUTCDate(date.getUTCDate() + 1);
  }
  let offset = 0;
  return days.map((day, i) => {
    const count =
      Math.floor(members.length / days.length) +
      (i < members.length % days.length ? 1 : 0);
    const group = members
      .slice(offset, offset + count)
      .map(({ id, name, number }) => ({ id, name, number }));
    offset += count;
    return { day, note: "", revision: 0, students: group };
  });
}
