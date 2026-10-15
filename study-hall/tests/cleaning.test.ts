import { test } from "node:test";
import assert from "node:assert/strict";
import { cleaningPlan } from "../src/cleaning-plan";
const students = Array.from({ length: 70 }, (_, i) => ({
  id: String(i),
  name: `가상학생 ${i}`,
  number: String(30101 + i),
  active: true,
  seat_id: null,
}));
test("70명 수·금 4주: 8회에 9명 6조·8명 2조, 전원 1회 학번순", () => {
  const plan = cleaningPlan([...students].reverse(), "2026-10-19", 4, [3, 5]);
  assert.deepEqual(
    plan.map((s) => s.day),
    [
      "2026-10-21",
      "2026-10-23",
      "2026-10-28",
      "2026-10-30",
      "2026-11-04",
      "2026-11-06",
      "2026-11-11",
      "2026-11-13",
    ],
  );
  assert.deepEqual(
    plan.map((s) => s.students.length),
    [9, 9, 9, 9, 9, 9, 8, 8],
  );
  assert.deepEqual(
    plan.flatMap((s) => s.students.map((s) => s.id)),
    students.map((s) => s.id),
  );
  assert.equal(plan.flatMap((s) => s.students).length, 70);
});
test("5주 10회는 7명씩, 중지·삭제 제외 및 잘못된 조건 거부", () => {
  assert.ok(
    cleaningPlan(students, "2026-10-19", 5, [3, 5]).every(
      (s) => s.students.length === 7,
    ),
  );
  assert.equal(
    cleaningPlan(
      [
        ...students,
        { ...students[0], id: "deleted", deleted_at: "2026-01-01" },
        { ...students[0], id: "inactive", active: false },
      ],
      "2026-10-19",
      4,
      [3, 5],
    ).flatMap((s) => s.students).length,
    70,
  );
  for (const days of [[3], [3, 3], [1, 3, 5], [3, 8]])
    assert.throws(() => cleaningPlan(students, "2026-10-19", 4, days));
  assert.throws(() => cleaningPlan(students, "2026-02-30", 4, [3, 5]));
  assert.throws(() => cleaningPlan([], "2026-10-19", 4, [3, 5]));
});
