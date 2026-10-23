import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  RosterImportResult,
  type RosterImportSummary,
} from "../src/RosterImportResult";

test("불러오기 확인창에 신규·중단·복구 학생과 실제 변경 내용을 표시", () => {
  const result: RosterImportSummary = {
    added: 1,
    stopped: 1,
    restored: 2,
    students: [{ id: "new", number: "30101", name: "신규학생" }],
    participation_changes: [
      {
        id: "stop",
        number: "30102",
        name: "중단학생",
        kind: "stopped",
        active: false,
        previous_seat: 7,
      },
      {
        id: "restore",
        number: "30103",
        name: "복구학생",
        kind: "restored",
        active: true,
        previous_seat: null,
      },
      {
        id: "inactive",
        number: "30104",
        name: "기존중지학생",
        kind: "restored",
        active: false,
        previous_seat: null,
      },
    ],
  };
  const html = renderToStaticMarkup(
    createElement(RosterImportResult, { result, onClose() {} }),
  );
  for (const text of [
    "신규학생",
    "30102",
    "중단학생",
    "복구학생",
    "기존중지학생",
    "7번 좌석 해제",
    "기존 이용 중지 유지",
    "확인",
    'role="dialog"',
  ])
    assert.ok(html.includes(text), text);
});

test("변경이 없으면 완료 확인창에서 변경 없음을 명확히 알린다", () => {
  const result: RosterImportSummary = {
    added: 0,
    stopped: 0,
    restored: 0,
    students: [],
    participation_changes: [],
  };
  const html = renderToStaticMarkup(
    createElement(RosterImportResult, { result, onClose() {} }),
  );
  assert.ok(html.includes("변경된 학생이 없습니다"));
  assert.ok(!html.includes("<tbody>"));
});
