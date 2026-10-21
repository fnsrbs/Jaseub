import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createHmac } from "node:crypto";
import { supervisionSheetSlots } from "../supabase/functions/api/supervision-sheet";
import { seatSheetScript } from "../supabase/functions/api/seat-sheet-script";

const grid = () => [
  ["1주차 (10/19~10/23)"],
  ["교시", "2026-10-19", 46315],
  ...Array.from({ length: 7 }, (_, i) => [
    i + 1,
    i === 6 ? "×" : "가상교사 A",
    "모의고사",
  ]),
];

test("구글 감독표: 교체·미배정·미운영·행사와 재불러오기 비교", () => {
  const initial = supervisionSheetSlots(grid(), []);
  assert.equal(initial.length, 14);
  assert.equal(initial[6].status, "closed");
  assert.equal(initial[7].day, "2026-10-20");
  assert.equal(initial[7].status, "event");
  const current = initial.map((s) => ({ ...s, revision: 1 }));
  assert.deepEqual(supervisionSheetSlots(grid(), current), []);
  const changed = grid();
  changed[2][1] = "가상교사 B";
  changed[3][1] = "";
  const edits = supervisionSheetSlots(changed, current);
  assert.equal(edits.length, 2);
  assert.equal(edits[0].teacher_name, "가상교사 B");
  assert.equal(edits[0].revision, 1);
  assert.equal(edits[1].status, "unassigned");
  const saved = current.map((s) => {
    const replacement = edits.find(
      (e) => e.day === s.day && e.period === s.period,
    );
    return replacement ? { ...replacement, revision: s.revision + 1 } : s;
  });
  assert.deepEqual(supervisionSheetSlots(changed, saved), []);
  assert.equal(saved.filter((s) => s.teacher_name === "가상교사 A").length, 4);
  assert.equal(saved.filter((s) => s.teacher_name === "가상교사 B").length, 1);
});

test("잘못된 날짜·중복·누락된 교시는 저장 전에 거부", () => {
  const existing = supervisionSheetSlots(grid(), []);
  assert.throws(() => supervisionSheetSlots([], existing), /찾지 못/);
  const bad = grid();
  bad[1][1] = "2026-02-30";
  assert.throws(() => supervisionSheetSlots(bad, existing), /날짜/);
  const missing = grid().map((r) => r.slice(0, 2));
  assert.throws(() => supervisionSheetSlots(missing, existing), /누락/);
  const duplicate = grid();
  duplicate[1][2] = "2026-10-19";
  assert.throws(() => supervisionSheetSlots(duplicate, existing), /중복/);
  const period = grid();
  period[3][0] = 3;
  assert.throws(() => supervisionSheetSlots(period, existing), /1~7교시/);
});

test("x·×로 운영 없음 처리 후 이름을 넣으면 감독 배정 복구", () => {
  for (const mark of ["x", "X", "×"]) {
    const rows = grid();
    rows[2][1] = mark;
    const initial = supervisionSheetSlots(rows, []).map((s) => ({
      ...s,
      revision: 1,
    }));
    assert.equal(initial[0].status, "closed");
    assert.equal(initial[0].teacher_name, "");
    rows[2][1] = "가상교사 C";
    const changes = supervisionSheetSlots(rows, initial);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].status, "assigned");
    assert.equal(changes[0].teacher_name, "가상교사 C");
  }
});

test("서명된 구글 요청으로 감독표만 읽고 병합된 행사 값을 펼친다", () => {
  const values = grid();
  for (let i = 3; i < values.length; i++) values[i][2] = "";
  const range = {
    getValues: () => values,
    getMergedRanges: () => [
      {
        getValue: () => "모의고사",
        getRow: () => 3,
        getLastRow: () => 9,
        getColumn: () => 3,
        getLastColumn: () => 3,
      },
    ],
  };
  const context: any = {
    Utilities: {
      Charset: { UTF_8: "utf8" },
      computeHmacSha256Signature: (p: string, k: string) => [
        ...createHmac("sha256", k).update(p).digest(),
      ],
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: {
      openById: () => ({
        getSheetByName: (name: string) => {
          assert.equal(name, "감독표(확정)");
          return { getLastRow: () => values.length, getRange: () => range };
        },
      }),
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (text: string) => ({ setMimeType: () => text }),
    },
  };
  vm.createContext(context);
  vm.runInContext(
    seatSheetScript
      .replace("__SHARED_SECRET__", "fixture-secret")
      .replace("__SPREADSHEET_ID__", "fixture-book")
      .replace("__SEAT_SHEET_ID__", "123"),
    context,
  );
  const payload = JSON.stringify({
    action: "supervision",
    spreadsheetId: "fixture-book",
    issuedAt: Date.now(),
    requestId: "a".repeat(36),
  });
  const result = JSON.parse(
    context.doPost({
      postData: {
        contents: JSON.stringify({
          payload,
          signature: createHmac("sha256", "fixture-secret")
            .update(payload)
            .digest("hex"),
        }),
      },
    }),
  );
  assert.equal(result.ok, true);
  assert.equal(
    supervisionSheetSlots(result.supervision, []).filter(
      (s) => s.status === "event",
    ).length,
    7,
  );
});
