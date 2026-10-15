import { test } from "node:test";
import assert from "node:assert/strict";
import { rememberedLogin, rememberLogin } from "../src/remembered-login";
test("코드 기억은 학생·교사와 데모·운영을 분리하고 해제하면 해당 코드만 삭제", () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => values.set(k, v),
      removeItem: (k: string) => values.delete(k),
    },
  });
  try {
    rememberLogin("production", "student", " a2b3c ", true);
    rememberLogin("production", "viewer", "D4E5F", true);
    rememberLogin("demo", "student", "X2Y3Z", true);
    assert.deepEqual(rememberedLogin("production"), {
      role: "viewer",
      codes: { student: "A2B3C", viewer: "D4E5F" },
    });
    assert.equal(rememberedLogin("demo").codes.student, "X2Y3Z");
    rememberLogin("production", "viewer", "", false);
    assert.deepEqual(rememberedLogin("production"), {
      role: "student",
      codes: { student: "A2B3C" },
    });
    rememberLogin("production", "student", "", false);
    assert.equal(values.has("sh-remembered-login-production"), false);
    values.set(
      "sh-remembered-login-production",
      '{"role":"teacher","codes":{"student":"bad","teacher":"secret"}}',
    );
    assert.deepEqual(rememberedLogin("production"), {
      role: "student",
      codes: {},
    });
    values.set("sh-remembered-login-production", "broken json");
    assert.deepEqual(rememberedLogin("production").codes, {});
  } finally {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});
