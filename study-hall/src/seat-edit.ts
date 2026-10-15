import { validateAssignments, type Student, type Seat } from "./domain";
export type Assignment = { student_id: string; seat_id: number | null };
export function editSeat(
  students: Student[],
  seats: Seat[],
  draft: Assignment[],
  seatId: number,
  studentId: string | null,
  fixed: string[] = [],
) {
  if (!seats.some((s) => s.id === seatId && s.enabled))
    throw Error("사용할 수 없는 좌석입니다.");
  const current = students.map((s) => ({
    ...s,
    seat_id:
      draft.find((p) => p.student_id === s.id)?.seat_id === undefined
        ? s.seat_id
        : draft.find((p) => p.student_id === s.id)!.seat_id,
  }));
  const occupant = current.find((s) => s.seat_id === seatId);
  const chosen = studentId
    ? current.find((s) => s.id === studentId && s.active && !s.deleted_at)
    : undefined;
  if (studentId && !chosen) throw Error("이용 가능한 학생을 선택하세요.");
  if (occupant?.id === chosen?.id) return draft;
  if (
    (occupant && fixed.includes(occupant.id)) ||
    (chosen && fixed.includes(chosen.id))
  )
    throw Error("고정 학생의 좌석은 먼저 고정을 해제하세요.");
  const updates = new Map(draft.map((p) => [p.student_id, p.seat_id]));
  if (occupant) updates.set(occupant.id, chosen?.seat_id ?? null);
  if (chosen) updates.set(chosen.id, seatId);
  return validateAssignments(
    students,
    seats,
    [...updates].map(([student_id, seat_id]) => ({ student_id, seat_id })),
  );
}
