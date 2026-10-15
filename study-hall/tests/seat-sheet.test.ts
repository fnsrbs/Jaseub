import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createHmac } from "node:crypto";
import { seatSheetScript } from "../supabase/functions/api/seat-sheet-script";
import {
  seatSheetRows,
  validateSheetEndpoint,
} from "../supabase/functions/api/seat-sheet-sync";
const secret = "a".repeat(64),
  workbook = "fixture-workbook";
function fixture(failOnce = false) {
  const labels = Array.from({ length: 40 }, () => Array(23).fill(""));
  const values = new Map<string, { value: string; formula: string }>();
  for (let i = 0; i < 72; i++) {
    const row = 5 + 2 * Math.floor(i / 6) + (i >= 30 ? 1 : 0),
      col = [1, 2, 4, 5, 7, 8][i % 6];
    labels[row][col] = `${72 - i}번`;
    values.set(`${row + 2}:${col + 1}`, {
      value: "original",
      formula: i === 0 ? "=originalFormula" : "",
    });
  }
  const original = JSON.stringify([...values]);
  let writes = 0,
    opened = 0;
  const cache = new Map<string, string>();
  const sheet = {
    getSheetId: () => 123,
    getRange: (r: number, c: number, h?: number) =>
      h
        ? { getDisplayValues: () => labels }
        : {
            isPartOfMerge: () => false,
            getFormula: () => values.get(`${r}:${c}`)!.formula,
            getValue: () => values.get(`${r}:${c}`)!.value,
            setRichTextValue: (v: any) => {
              writes++;
              if (failOnce && writes === 3) {
                failOnce = false;
                throw Error("simulated write failure");
              }
              values.set(`${r}:${c}`, { value: v.text, formula: "" });
            },
            setFormula: (v: string) =>
              values.set(`${r}:${c}`, { value: "original", formula: v }),
            setValue: (v: string) =>
              values.set(`${r}:${c}`, { value: v, formula: "" }),
          },
  };
  const context: any = {
    Utilities: {
      Charset: { UTF_8: "utf8" },
      computeHmacSha256Signature: (text: string, key: string) => [
        ...createHmac("sha256", key).update(text).digest(),
      ],
    },
    LockService: {
      getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }),
    },
    SpreadsheetApp: {
      openById: (id: string) => {
        assert.equal(id, workbook);
        opened++;
        return { getSheets: () => [sheet] };
      },
      newRichTextValue: () => ({
        setText: (text: string) => ({ build: () => ({ text }) }),
      }),
      flush: () => {},
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key: string) => cache.get(key),
        put: (key: string, value: string) => cache.set(key, value),
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
      .replace("__SHARED_SECRET__", secret)
      .replace("__SPREADSHEET_ID__", workbook)
      .replace("__SEAT_SHEET_ID__", "123"),
    context,
  );
  const seats = Array.from({ length: 72 }, (_, i) => ({
    id: i + 1,
    number: String(i + 1),
    name: `가상학생 ${i + 1}`,
  }));
  const call = (override: any = {}, badSignature = false) => {
    const payload = JSON.stringify({
      action: "sync",
      issuedAt: Date.now(),
      requestId: "12345678-1234-1234-1234-123456789abc",
      spreadsheetId: workbook,
      seats,
      ...override,
    });
    const signature = badSignature
      ? "0".repeat(64)
      : createHmac("sha256", secret).update(payload).digest("hex");
    return JSON.parse(
      context.doPost({
        postData: { contents: JSON.stringify({ payload, signature }) },
      }),
    );
  };
  return {
    call,
    values,
    original,
    labels,
    seats,
    writes: () => writes,
    opened: () => opened,
  };
}
test("시트 반영은 유효 서명·시각·고정 대상일 때만 허용", () => {
  const f = fixture();
  assert.equal(f.call({}, true).ok, false);
  assert.equal(f.call({ issuedAt: Date.now() - 600000 }).ok, false);
  assert.equal(f.call({ spreadsheetId: "other" }).ok, false);
  assert.equal(f.opened(), 0);
  assert.equal(f.call({ action: "check" }).ready, true);
  assert.equal(f.writes(), 0);
});
test("72개 이름 칸만 갱신하고 수식처럼 생긴 입력도 문자로 저장", () => {
  const f = fixture();
  f.seats[0] = { id: 1, number: "=FORMULA", name: "=NOT_CODE" };
  assert.equal(f.call({ seats: f.seats }).updated, 72);
  assert.equal(f.values.size, 72);
  assert.equal(f.writes(), 72);
  assert.ok(
    [...f.values.values()].some(
      (v) => v.value === "=FORMULA\n=NOT_CODE" && v.formula === "",
    ),
  );
  assert.equal(f.call().ok, false);
  assert.equal(f.writes(), 72);
});
test("좌석번호 구조 이상·중복 데이터는 쓰기 전에 거부", () => {
  const f = fixture();
  f.labels[0][0] = "1번";
  assert.equal(f.call().ok, false);
  assert.equal(f.writes(), 0);
  const g = fixture();
  g.seats[1].id = 1;
  assert.equal(g.call({ seats: g.seats }).ok, false);
  assert.equal(g.writes(), 0);
});
test("반영 중 실패하면 기존 수식·값 복구", () => {
  const f = fixture(true);
  const result = f.call();
  assert.equal(result.ok, false);
  assert.match(result.error, /복구/);
  assert.equal(JSON.stringify([...f.values]), f.original);
});
test("확정 좌석 원본만 사용하고 외부 URL·좌석 충돌 거부", () => {
  const seats = Array.from({ length: 72 }, (_, i) => ({
    id: i + 1,
    enabled: true,
  }));
  const rows = seatSheetRows(seats, [
    { name: "A", number: "1", seat_id: 72 },
    { name: "B", number: "2", seat_id: null },
  ]);
  assert.equal(rows[71].name, "A");
  assert.equal(rows[0].name, "");
  assert.throws(
    () =>
      seatSheetRows(seats, [
        { name: "A", number: "1", seat_id: 1 },
        { name: "B", number: "2", seat_id: 1 },
      ]),
    /좌석 배정/,
  );
  for (const url of [
    "https://evil.test/exec",
    "https://script.google.com.evil.test/macros/s/id/exec",
    "http://script.google.com/macros/s/id/exec",
    "https://script.google.com/macros/s/id/dev",
    "https://script.google.com/macros/s/id/exec?token=x",
  ])
    assert.throws(() => validateSheetEndpoint(url));
  assert.equal(
    validateSheetEndpoint("https://script.google.com/macros/s/id/exec"),
    "https://script.google.com/macros/s/id/exec",
  );
});
