import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createHmac } from "node:crypto";
import { seatSheetScript } from "../supabase/functions/api/seat-sheet-script";
test("출석 시트 서명·월별 분리·날짜별 갱신·구버전 거부·수식 방지·실패 복구", () => {
  const secret = "b".repeat(64);
  const sheets = new Map<string, any>();
  const properties = new Map<string, string>();
  let fail = false;
  const makeSheet = (name: string) => {
    const rows: string[][] = [];
    const sheet: any = {
      rows,
      getLastRow: () => {
        let n = rows.length;
        while (n && !rows[n - 1].some(Boolean)) n--;
        return n;
      },
      getMaxRows: () => 10000,
      getSheetId: () => 456,
      getRange: (r: number, c: number, h: number, w: number) => {
        const range: any = {
          getDisplayValues: () =>
            Array.from({ length: h }, (_, i) =>
              Array.from({ length: w }, (_, j) =>
                String(rows[r - 1 + i]?.[c - 1 + j] || "").replace(/^'/, ""),
              ),
            ),
          clearContent: () => {
            for (let i = 0; i < h; i++)
              for (let j = 0; j < w; j++) {
                rows[r - 1 + i] ||= Array(12).fill("");
                rows[r - 1 + i][c - 1 + j] = "";
              }
            return range;
          },
          setValues: (values: string[][]) => {
            if (fail) {
              fail = false;
              throw Error("write failure");
            }
            for (let i = 0; i < h; i++)
              for (let j = 0; j < w; j++) {
                rows[r - 1 + i] ||= Array(12).fill("");
                rows[r - 1 + i][c - 1 + j] = values[i][j];
              }
            return range;
          },
        };
        for (const op of [
          "setNumberFormat",
          "setBackground",
          "setFontColor",
          "setFontWeight",
          "setWrap",
          "setVerticalAlignment",
        ])
          range[op] = () => range;
        return range;
      },
      setFrozenRows: () => {},
      setFrozenColumns: () => {},
      setColumnWidths: () => {},
      setColumnWidth: () => {},
    };
    sheets.set(name, sheet);
    return sheet;
  };
  const book = {
    getSheetByName: (name: string) => sheets.get(name),
    insertSheet: makeSheet,
    getUrl: () => "https://docs.google.com/spreadsheets/d/fixture/edit",
  };
  const context: any = {
    Utilities: {
      Charset: { UTF_8: "utf8" },
      computeHmacSha256Signature: (text: string, key: string) => [
        ...createHmac("sha256", key).update(text).digest(),
      ],
      formatDate: () => "2026-10-16 12:00:00",
    },
    LockService: {
      getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key: string) => properties.get(key),
        setProperty: (key: string, value: string) => properties.set(key, value),
      }),
    },
    SpreadsheetApp: {
      openById: (id: string) => {
        assert.equal(id, "fixture");
        return book;
      },
      flush: () => {},
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (value: string) => ({ setMimeType: () => value }),
    },
  };
  vm.createContext(context);
  vm.runInContext(
    seatSheetScript
      .replace("__SHARED_SECRET__", secret)
      .replace("__SPREADSHEET_ID__", "fixture")
      .replace("__SEAT_SHEET_ID__", "123"),
    context,
  );
  const call = (
    day: string,
    generation: number,
    rows: any[],
    signatureValid = true,
  ) => {
    const payload = JSON.stringify({
      action: "attendance",
      issuedAt: Date.now(),
      requestId: "12345678-1234-1234-1234-123456789abc",
      spreadsheetId: "fixture",
      attendance: { day, generation, rows },
    });
    const signature = signatureValid
      ? createHmac("sha256", secret).update(payload).digest("hex")
      : "0".repeat(64);
    return JSON.parse(
      context.doPost({
        postData: { contents: JSON.stringify({ payload, signature }) },
      }),
    );
  };
  const entry = {
    number: "30101",
    name: "=HYPERLINK(1)",
    statuses: ["출석", "", "", "", "", "", "—"],
    note: "=1+1",
  };
  assert.equal(call("2026-10-16", 1, [entry], false).ok, false);
  assert.equal(sheets.size, 0);
  assert.equal(call("2026-10-16", 1, [entry]).ok, true);
  const october = sheets.get("교시별출석_2026-10");
  assert.equal(october.rows[1][2], "'=HYPERLINK(1)");
  assert.equal(october.rows[1][10], "'=1+1");
  assert.equal(
    call("2026-10-19", 2, [{ ...entry, name: "가상", note: "" }]).ok,
    true,
  );
  assert.equal(october.getLastRow(), 3);
  assert.equal(
    call("2026-10-16", 3, [
      { ...entry, statuses: ["지각", "", "", "", "", "", "—"] },
    ]).ok,
    true,
  );
  assert.equal(october.getLastRow(), 3);
  assert.equal(october.rows[1][3], "지각");
  assert.equal(call("2026-10-16", 2, [entry]).ok, false);
  const before = JSON.stringify(october.rows);
  fail = true;
  assert.equal(call("2026-10-16", 4, [{ ...entry, name: "변경" }]).ok, false);
  assert.equal(JSON.stringify(october.rows), before);
  assert.equal(properties.get("attendance-generation-2026-10-16"), "3");
  assert.equal(call("2026-10-16", 5, []).ok, true);
  assert.equal(october.getLastRow(), 2);
  assert.equal(october.rows[1][0], "2026-10-19");
  assert.equal(call("2026-11-02", 6, [entry]).ok, true);
  assert.equal(sheets.size, 2);
  assert.equal(call("2026-11-02", 7, [entry, entry]).ok, false);
});
