import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WarningCards } from "../src/WarningCards";
import type { Snapshot } from "../src/domain";
const data = {
  students: [
    { id: "own", name: "본인학생", number: "101", active: true, seat_id: null },
    {
      id: "other",
      name: "다른학생",
      number: "102",
      active: true,
      seat_id: null,
    },
  ],
  warnings: [
    {
      id: "1",
      student_id: "own",
      reason: "본인 경고 사유",
      created_at: "2026-10-15T00:00:00Z",
    },
    {
      id: "2",
      student_id: "other",
      reason: "다른 학생 비공개 사유",
      created_at: "2026-10-15T00:00:00Z",
    },
    {
      id: "3",
      student_id: "own",
      reason: "삭제된 사유",
      created_at: "2026-10-15T00:00:00Z",
      deleted_at: "2026-10-15T01:00:00Z",
    },
  ],
} as Snapshot;
const render = (canManage: boolean, studentId?: string) =>
  renderToStaticMarkup(
    createElement(WarningCards, {
      data,
      canManage,
      studentId,
      busy: false,
      act: async () => ({}),
    }),
  );
test("학생 경고 화면은 혼합 데이터에서도 본인 유효 카드만 표시", () => {
  const html = render(false, "own");
  assert.match(html, /본인 경고 사유/);
  assert.match(html, /누적 경고 1회/);
  for (const hidden of [
    "다른학생",
    "다른 학생 비공개 사유",
    "삭제된 사유",
    "전체 학생",
    "학생 선택 / 내역 필터",
    "경고카드 1장 발급",
  ])
    assert.equal(html.includes(hidden), false, hidden);
});
test("학생 신원 누락 시 전체 카드로 대체하지 않음", () => {
  const html = render(false);
  assert.equal(html.includes("본인 경고 사유"), false);
  assert.equal(html.includes("다른 학생 비공개 사유"), false);
});
test("교사·관리자는 전체 학생 필터와 유효 카드 관리 가능", () => {
  const html = render(true);
  assert.match(html, /본인 경고 사유/);
  assert.match(html, /다른 학생 비공개 사유/);
  assert.match(html, /전체 학생/);
  assert.match(html, /경고카드 1장 발급/);
  assert.equal(html.includes("삭제된 사유"), false);
});
