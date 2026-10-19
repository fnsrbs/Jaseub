import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeDaily,
  type DailySource,
} from "../supabase/functions/api/attendance-daily";
const payload = { start: "2026-10-01", end: "2026-10-31", student_id: "one" };
const now = Date.parse("2026-10-31T18:00:00+09:00");
const source = (statuses: string[], day = "2026-10-19"): DailySource => ({
  day,
  student_id: "one",
  entries: statuses.map((status, i) => ({ period: i + 1, status, note: "" })),
});
const run = (s: DailySource[], p = payload, time = now) =>
  summarizeDaily(s, p, time);
test("하루 출결 흐름: 앞 결석은 지각·중간 결석은 결과·뒤 결석은 조퇴·전부 결석만 결석 1일", () => {
  for (const [statuses, key, periods] of [
    [
      [
        "absent",
        "absent",
        "present",
        "present",
        "present",
        "present",
        "present",
      ],
      "late",
      [1, 2],
    ],
    [
      [
        "present",
        "present",
        "absent",
        "absent",
        "present",
        "present",
        "present",
      ],
      "missed",
      [3, 4],
    ],
    [
      [
        "present",
        "present",
        "present",
        "present",
        "present",
        "absent",
        "absent",
      ],
      "early",
      [6, 7],
    ],
  ] as const) {
    const r = run([source([...statuses])]);
    assert.equal(r.summaries[0][key], 1);
    assert.equal(r.summaries[0].absent, 0);
    assert.equal(r.summaries[0].irregular_days, 1);
    assert.deepEqual(
      r.records.map((e) => e.period),
      periods,
    );
  }
  const r = run([source(Array(7).fill("absent"))]);
  assert.equal(r.summaries[0].absent, 1);
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].period, null);
});
test("같은 날 중복은 1일·지각 결과 조퇴 합산 3일당 결석1일·전체기간 누적 퇴출대상", () => {
  const mixed = source([
    "late",
    "absent",
    "present",
    "present",
    "present",
    "present",
    "absent",
  ]);
  assert.equal(run([mixed]).summaries[0].irregular_days, 1);
  const days = [
    source(Array(7).fill("absent"), "2026-10-05"),
    source(Array(7).fill("excused"), "2026-10-06"),
    mixed,
    source(["absent", ...Array(6).fill("present")], "2026-10-20"),
    source(["present", "absent", ...Array(4).fill("present")], "2026-10-21"),
  ];
  const r = run(days, { ...payload, start: "2026-10-19" });
  assert.equal(r.summaries[0].absent, 0);
  assert.equal(r.summaries[0].lifetime_absent, 2);
  assert.equal(r.summaries[0].lifetime_irregular, 3);
  assert.equal(r.summaries[0].lifetime_equivalent, 3);
  assert.equal(r.summaries[0].removal_candidate, true);
});
test("인정결석 기본 포함·명시한 면접/기타 사유만 제외·문자열 메모로 자동 제외하지 않음", () => {
  const normal = source(Array(7).fill("excused"));
  normal.entries.forEach((e) => (e.note = "면접고사"));
  assert.equal(run([normal]).summaries[0].absent, 1);
  for (const reason of ["면접고사", "기타: 학교 행사"]) {
    const s = source(Array(7).fill("excused"));
    s.entries.forEach((e) => (e.exempt_reason = reason));
    const r = run([s]);
    assert.equal(r.summaries[0].lifetime_equivalent, 0);
    assert.equal(r.summaries[0].excused, 1);
    assert.ok(r.records.every((e) => e.exempt_reason === reason));
  }
});
test("종료 전 미집계·월화7 수목금6교시 확인 필요·주말 제외·본인 필터", () => {
  const s = source(Array(7).fill("present"));
  assert.equal(
    run([s], payload, Date.parse("2026-10-19T16:29:59+09:00")).summaries.length,
    0,
  );
  assert.equal(
    run([s], payload, Date.parse("2026-10-19T16:30:00+09:00")).summaries[0]
      .present,
    1,
  );
  const incomplete = source(Array(6).fill("present"));
  assert.equal(run([incomplete]).summaries[0].pending_days, 1);
  assert.equal(run([incomplete]).summaries[0].present, 0);
  assert.equal(
    run([source(Array(6).fill("present"), "2026-10-21")]).summaries[0].present,
    1,
  );
  assert.equal(run([{ ...s, student_id: "other" }]).summaries.length, 0);
  assert.equal(
    run([source(Array(7).fill("present"), "2026-10-24")]).summaries.length,
    0,
  );
});
test("QR 마지막 퇴실로 조퇴·정시 자동퇴실/재입실 후 미퇴실은 조퇴 아님·면접 교시는 제외", () => {
  const s = source(Array(7).fill("present"));
  s.last_exit = "2026-10-19T14:10:00+09:00";
  const r = run([s]);
  assert.equal(r.summaries[0].early, 1);
  assert.deepEqual(
    r.records.map((e) => e.period),
    [5, 6, 7],
  );
  assert.equal(
    run([{ ...s, last_exit: "2026-10-19T16:30:00+09:00" }]).summaries[0]
      .present,
    1,
  );
  assert.equal(run([{ ...s, last_exit: null }]).summaries[0].present, 1);
  for (const e of s.entries)
    if (e.period >= 5) {
      e.status = "excused";
      e.exempt_reason = "면접고사";
    }
  assert.equal(run([s]).summaries[0].lifetime_irregular, 0);
});
