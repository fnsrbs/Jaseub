import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { farewellRecord, farewellVisibility } from "../src/farewell";
import { FarewellLetter } from "../src/FarewellLetter";

test("마지막 날 한국 자정부터 자동 표시, 다음 날부터 다시 보기만 제공", () => {
  assert.deepEqual(
    farewellVisibility(Date.parse("2026-11-16T23:59:59+09:00")),
    { available: false, autoOpen: false },
  );
  assert.deepEqual(farewellVisibility(Date.parse("2026-11-16T15:00:00Z")), {
    available: true,
    autoOpen: true,
  });
  assert.deepEqual(
    farewellVisibility(Date.parse("2026-11-17T23:59:59+09:00")),
    { available: true, autoOpen: true },
  );
  assert.deepEqual(
    farewellVisibility(Date.parse("2026-11-18T00:00:00+09:00")),
    { available: true, autoOpen: false },
  );
});

test("본인의 퇴실 완료 기록만 합산하고 같은 날 재입실은 하루로 계산", () => {
  const visit = (
    id: string,
    student_id: string,
    entered_at: string,
    exited_at: string | null,
  ) => ({ id, student_id, entered_at, exited_at });
  const record = farewellRecord(
    [
      visit(
        "1",
        "me",
        "2026-11-15T10:00:00+09:00",
        "2026-11-15T12:00:00+09:00",
      ),
      visit(
        "2",
        "me",
        "2026-11-15T13:00:00+09:00",
        "2026-11-15T14:30:00+09:00",
      ),
      visit(
        "3",
        "me",
        "2026-11-16T10:00:00+09:00",
        "2026-11-16T11:00:00+09:00",
      ),
      visit(
        "4",
        "other",
        "2026-11-16T10:00:00+09:00",
        "2026-11-16T16:00:00+09:00",
      ),
      visit("5", "me", "2026-11-17T10:00:00+09:00", null),
    ],
    "me",
    Date.parse("2026-11-17T12:00:00+09:00"),
    16,
  );
  assert.deepEqual(record, { seconds: 4.5 * 3600, days: 2 });
});

test("기록이나 수집이 없어도 응원과 완주 트로피를 표시하고 12년을 집계 수치로 오해하지 않게 안내", () => {
  const html = renderToStaticMarkup(
    createElement(FarewellLetter, {
      name: "테스트",
      seconds: 0,
      days: 0,
      clovers: 0,
      awards: { crowns: 0, stars: 0 },
      awardsError: false,
      retry() {},
    }),
  );
  for (const text of [
    "0시간 0분",
    "0일",
    "퇴실이 완료된",
    "노력의 일부일 뿐이야",
    "12년의 시간",
    "끝까지 걸어온 너에게",
    "합격을 진심으로 응원해",
  ])
    assert.ok(html.includes(text), text);
});

test("수집 조회 실패 시 왕관과 별을 0개로 표시하지 않고 재시도 제공", () => {
  const html = renderToStaticMarkup(
    createElement(FarewellLetter, {
      name: "테스트",
      seconds: 3600,
      days: 1,
      clovers: 3,
      awards: null,
      awardsError: true,
      retry() {},
    }),
  );
  assert.ok(html.includes("왕관·별 기록 다시 불러오기"));
  assert.ok(!html.includes("0개"));
});
