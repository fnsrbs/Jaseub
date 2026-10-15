import { test } from "node:test";
import assert from "node:assert/strict";
import { classroomSeats } from "../src/seat-layout";
import { pairLottery, validateDeskPairs, deskKey } from "../src/seat-pairs";
import type { Student } from "../src/domain";
const seats = classroomSeats();
const person = (
  id: string,
  gender: Student["gender"],
  seat_id: number | null = null,
): Student => ({ id, name: id, number: id, active: true, gender, seat_id });
test("69명·남18 여51: 중복 없이 동성 짝, 빈 짝자리 허용", () => {
  const students = Array.from({ length: 69 }, (_, i) =>
    person(String(i), i < 18 ? "male" : "female"),
  );
  for (let attempt = 0; attempt < 25; attempt++) {
    const result = pairLottery(
      students,
      seats,
      students.map((s) => s.id),
      seats.map((s) => s.id),
      [],
    );
    assert.equal(result.length, 69);
    assert.equal(new Set(result.map((p) => p.seat_id)).size, 69);
    assert.doesNotThrow(() => validateDeskPairs(students, seats, result));
  }
});
test("고정·미선택 학생의 옆자리는 같은 성별에게만 배정", () => {
  const students = [
    person("fixed", "male", 1),
    person("girl", "female"),
    person("boy", "male"),
  ];
  const result = pairLottery(
    students,
    seats,
    ["girl", "boy"],
    [2, 3, 4],
    [],
    () => 0.2,
  );
  assert.equal(result.find((p) => p.student_id === "boy")?.seat_id, 2);
  assert.notEqual(result.find((p) => p.student_id === "girl")?.seat_id, 2);
  assert.equal(students[0].seat_id, 1);
  const fixedResult = pairLottery(
    students,
    seats,
    students.map((s) => s.id),
    [2, 3, 4],
    ["fixed"],
    () => 0.2,
  );
  assert.equal(fixedResult.find((p) => p.student_id === "fixed")?.seat_id, 1);
});
test("자리 수는 충분해도 한 책상에 남녀를 섞어야 하면 거부", () => {
  const students = [person("m", "male"), person("f", "female")];
  assert.throws(
    () => pairLottery(students, seats, ["m", "f"], [1, 2], []),
    /불가능/,
  );
  assert.throws(
    () =>
      validateDeskPairs(students, seats, [
        { student_id: "m", seat_id: 1 },
        { student_id: "f", seat_id: 2 },
      ]),
    /같은 성별/,
  );
});
test("미확인·비활성 좌석·부족 좌석 처리, 서로 다른 책상과 통로 구분", () => {
  assert.throws(
    () => pairLottery([person("u", "unknown")], seats, ["u"], [1], []),
    /성별/,
  );
  assert.throws(
    () =>
      pairLottery(
        [person("m", "male")],
        seats.map((s) => ({ ...s, enabled: false })),
        ["m"],
        [1],
        [],
      ),
    /부족/,
  );
  assert.equal(
    deskKey(seats.find((s) => s.id === 1)!),
    deskKey(seats.find((s) => s.id === 2)!),
  );
  assert.notEqual(
    deskKey(seats.find((s) => s.id === 2)!),
    deskKey(seats.find((s) => s.id === 3)!),
  );
  const students = [person("u", "unknown", 1), person("m", "male")];
  assert.throws(() => pairLottery(students, seats, ["m"], [2], []), /불가능/);
});
