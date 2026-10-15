import { test } from "node:test";
import assert from "node:assert/strict";
import { editSeat } from "../src/seat-edit";
import type { Student } from "../src/domain";
const students: Student[] = [
  { id: "a", name: "A", number: "1", active: true, seat_id: 1 },
  { id: "b", name: "B", number: "2", active: true, seat_id: 2 },
  { id: "c", name: "C", number: "3", active: true, seat_id: null },
];
const seats = [1, 2, 3].map((id) => ({ id, row: 1, col: id, enabled: true }));
test("이미 배정된 친구 선택 시 두 학생 교환·원본 유지", () => {
  const result = editSeat(students, seats, [], 1, "b");
  assert.equal(result.find((p) => p.student_id === "a")?.seat_id, 2);
  assert.equal(result.find((p) => p.student_id === "b")?.seat_id, 1);
  assert.equal(students[0].seat_id, 1);
});
test("빈자리 이동·미배정 학생 추가·빈자리로 비우기", () => {
  assert.deepEqual(editSeat(students, seats, [], 3, "a"), [
    { student_id: "a", seat_id: 3 },
  ]);
  const added = editSeat(students, seats, [], 1, "c");
  assert.equal(added.find((p) => p.student_id === "a")?.seat_id, null);
  assert.equal(added.find((p) => p.student_id === "c")?.seat_id, 1);
  assert.deepEqual(editSeat(students, seats, [], 1, null), [
    { student_id: "a", seat_id: null },
  ]);
  assert.deepEqual(editSeat(students, seats, [], 3, null), []);
});
test("추첨 미리보기 기준으로 연속 교환해도 중복 없음", () => {
  const draft = [
    { student_id: "a", seat_id: 2 },
    { student_id: "b", seat_id: 3 },
    { student_id: "c", seat_id: 1 },
  ];
  const changed = editSeat(students, seats, draft, 1, "b");
  assert.equal(changed.find((p) => p.student_id === "c")?.seat_id, 3);
  assert.equal(changed.find((p) => p.student_id === "b")?.seat_id, 1);
  const next = editSeat(students, seats, changed, 2, "b");
  assert.equal(next.find((p) => p.student_id === "a")?.seat_id, 1);
  assert.equal(new Set(next.map((p) => p.seat_id)).size, 3);
});
test("고정 학생·사용불가 좌석·비활성 학생 이동 차단", () => {
  assert.throws(() => editSeat(students, seats, [], 1, "b", ["a"]), /고정/);
  assert.throws(() => editSeat(students, seats, [], 3, "b", ["b"]), /고정/);
  assert.throws(
    () =>
      editSeat(
        students,
        seats.map((s) => ({ ...s, enabled: false })),
        [],
        1,
        "b",
      ),
    /좌석/,
  );
  assert.throws(
    () =>
      editSeat(
        students.map((s) => ({ ...s, active: false })),
        seats,
        [],
        1,
        "b",
      ),
    /학생/,
  );
});
