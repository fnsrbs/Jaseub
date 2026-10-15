import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attendanceVerdict,
  csv,
  dailyUsage,
  lottery,
  totals,
  validateAssignments,
  validQr,
  type Student,
  type Visit,
} from "../src/domain";
const students: Student[] = [
  { id: "a", name: "A", number: "1", active: true, seat_id: 1 },
  { id: "b", name: "B", number: "2", active: true, seat_id: 2 },
  { id: "c", name: "C", number: "3", active: true, seat_id: 3 },
];
const seats = [1, 2, 3].map((id) => ({ id, row: 1, col: id, enabled: true }));
const visit = (
  entered_at: string,
  exited_at: string | null,
  id = "v",
): Visit => ({ id, student_id: "a", entered_at, exited_at });
test("한국 자정 경계와 재입실 합산", () => {
  const result = dailyUsage([
    visit("2026-10-12T23:30:00+09:00", "2026-10-13T00:30:00+09:00"),
    visit("2026-10-13T09:00:00+09:00", "2026-10-13T10:00:00+09:00", "v2"),
  ]);
  assert.equal(result["2026-10-12"].confirmed, 1800);
  assert.equal(result["2026-10-13"].confirmed, 5400);
});
test("진행 중·퇴실 누락 기록은 확정 통계에서 제외", () => {
  const now = Date.parse("2026-10-14T12:00:00+09:00");
  const visits = [
    visit("2026-10-14T11:00:00+09:00", null),
    visit("2026-10-01T11:00:00+09:00", null, "old"),
  ];
  const result = totals(visits, now, 16);
  assert.equal(result.all, 0);
  assert.equal(result.days["2026-10-14"].ongoing, 3600);
  assert.ok(Object.values(result.days).some((x) => x.review > 0));
  assert.ok(Object.keys(result.days).length < 5);
});
test("주간 통계는 월요일 시작", () => {
  const visits = [
    visit("2026-10-11T10:00:00+09:00", "2026-10-11T11:00:00+09:00"),
    visit("2026-10-12T10:00:00+09:00", "2026-10-12T11:00:00+09:00", "v2"),
  ];
  assert.equal(
    totals(visits, Date.parse("2026-10-14T12:00:00+09:00")).week,
    3600,
  );
});
test("주간 확정은 월~금만 합산하고 주말·다음 주 월요일 경계를 구분", () => {
  const visits = [
    visit("2026-10-12T10:00:00+09:00", "2026-10-12T11:00:00+09:00"),
    visit("2026-10-16T23:30:00+09:00", "2026-10-17T00:30:00+09:00", "fri"),
    visit("2026-10-17T10:00:00+09:00", "2026-10-17T11:00:00+09:00", "sat"),
    visit("2026-10-18T10:00:00+09:00", "2026-10-18T11:00:00+09:00", "sun"),
  ];
  for (const day of ["17", "18"]) {
    const t = totals(visits, Date.parse(`2026-10-${day}T23:00:00+09:00`));
    assert.equal(t.week, 5400);
    assert.equal(t.month, 14400);
  }
  assert.equal(totals(visits, Date.parse("2026-10-19T00:00:00+09:00")).week, 0);
});
test("좌석 중복과 선택하지 않은 학생 좌석 침범 거부", () => {
  assert.throws(() =>
    validateAssignments(students, seats, [
      { student_id: "a", seat_id: 1 },
      { student_id: "b", seat_id: 1 },
    ]),
  );
  assert.throws(() =>
    validateAssignments(students, seats, [{ student_id: "a", seat_id: 3 }]),
  );
});
test("좌석 부족 거부 및 미리보기 원본 유지·고정 좌석 유지", () => {
  const before = structuredClone(students);
  assert.throws(() => lottery(students, seats, ["a", "b", "c"], [1, 2], []));
  const preview = lottery(
    students,
    seats,
    ["a", "b", "c"],
    [1, 2, 3],
    ["a"],
    () => 0.1,
  );
  assert.equal(preview.find((p) => p.student_id === "a")?.seat_id, 1);
  assert.equal(new Set(preview.map((p) => p.seat_id)).size, 3);
  assert.deepEqual(students, before);
});
test("설정 없으면 지각·결석 판정하지 않음, 운영 종료 후 결석", () => {
  const now = Date.parse("2026-10-14T23:00:00+09:00");
  assert.equal(attendanceVerdict("a", undefined, [], now), "판정 설정 없음");
  const day = {
    day: "2026-10-14",
    start_time: "18:00",
    end_time: "22:00",
    student_ids: ["a"],
  };
  assert.equal(attendanceVerdict("a", day, [], now), "결석");
  assert.equal(attendanceVerdict("b", day, [], now), "판정 설정 없음");
  assert.equal(
    attendanceVerdict(
      "a",
      day,
      [visit("2026-10-14T18:01:00+09:00", null)],
      now,
    ),
    "지각",
  );
});
test("QR은 기대하는 형식만 허용", () => {
  assert.ok(validQr("SH1." + "a".repeat(64)));
  assert.equal(validQr("https://evil.example"), false);
  assert.equal(validQr("SH1.short"), false);
});
test("CSV BOM·수식 삽입·따옴표·줄바꿈", () => {
  const output = csv([["=SUM(1,2)", "  @evil", '정상 "한글"', "줄\n바꿈"]]);
  assert.ok(output.startsWith("\uFEFF"));
  assert.ok(output.includes('"\'=SUM(1,2)"'));
  assert.ok(output.includes('"\'  @evil"'));
  assert.ok(output.includes('정상 ""한글""'));
});
