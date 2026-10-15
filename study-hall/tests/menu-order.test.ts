import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultMenus, orderedMenu } from "../src/menu-order";
test("메뉴 순서는 역할의 허용 메뉴만 사용하고 빠진 새 메뉴는 뒤에 추가", () => {
  const menu = orderedMenu("student", {
    student: ["stats", "settings", "stats", "home"],
  });
  assert.deepEqual(
    menu.slice(0, 2).map((m) => m[0]),
    ["stats", "home"],
  );
  assert.equal(menu.length, defaultMenus.student.length);
  assert.equal(
    menu.some((m) => m[0] === "settings"),
    false,
  );
  assert.deepEqual(
    new Set(menu.map((m) => m[0])),
    new Set(defaultMenus.student.map((m) => m[0])),
  );
  assert.deepEqual(orderedMenu("viewer", {}), defaultMenus.viewer);
});
