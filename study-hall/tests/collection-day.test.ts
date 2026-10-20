import { test } from "node:test";
import assert from "node:assert/strict";
import { collectionDayEligible } from "../src/study-ranking";

test("미운영·단축 운영은 왕관·별·클로버 지급 대상에서 제외", () => {
  const operation = { day: "2026-10-20", start_time: "08:50:00", end_time: "16:30:00", student_ids: ["a"], is_closed: false };
  assert.equal(collectionDayEligible(operation.day, operation), true);
  assert.equal(collectionDayEligible(operation.day, { ...operation, is_closed: true }), false);
  assert.equal(collectionDayEligible(operation.day, { ...operation, start_time: "06:00", end_time: "08:00" }), false);
  assert.equal(collectionDayEligible(operation.day, { ...operation, end_time: "16:29" }), false);
  assert.equal(collectionDayEligible(operation.day, { ...operation, start_time: "08:51" }), false);
  assert.equal(collectionDayEligible(operation.day, { ...operation, student_ids: [] }), false);
  assert.equal(collectionDayEligible("2026-10-21", { ...operation, day: "2026-10-21", end_time: "15:30" }), true);
  assert.equal(collectionDayEligible("2026-10-18"), false);
});
