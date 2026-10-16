import { test } from "node:test";
import assert from "node:assert/strict";
import { pollWhileVisible } from "../src/visible-polling";

test("백그라운드 조회 중단·복귀 즉시 갱신·중복 방지·정리", async (t) => {
  const target = new EventTarget();
  let visibilityState = "visible";
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      get visibilityState() {
        return visibilityState;
      },
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
    },
  });
  t.mock.timers.enable({ apis: ["setInterval"] });
  const visibility = (state: string) => {
    visibilityState = state;
    target.dispatchEvent(new Event("visibilitychange"));
  };
  const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));
  let calls = 0;
  let release: (() => void) | undefined;
  let block = false;
  const task = async () => {
    calls++;
    if (block)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
  };
  let stop = () => {};
  try {
    stop = pollWhileVisible(task, 15000);
    assert.equal(calls, 1);
    await settle();
    t.mock.timers.tick(15000);
    assert.equal(calls, 2);
    await settle();
    visibility("hidden");
    t.mock.timers.tick(300000);
    assert.equal(calls, 2);
    visibility("visible");
    assert.equal(calls, 3);
    await settle();
    block = true;
    t.mock.timers.tick(15000);
    assert.equal(calls, 4);
    t.mock.timers.tick(60000);
    assert.equal(calls, 4);
    release?.();
    await settle();
    stop();
    visibility("hidden");
    visibility("visible");
    t.mock.timers.tick(60000);
    assert.equal(calls, 4);
    block = false;
    visibility("hidden");
    stop = pollWhileVisible(task, 15000);
    t.mock.timers.tick(60000);
    assert.equal(calls, 4);
    visibility("visible");
    assert.equal(calls, 5);
  } finally {
    stop();
    t.mock.timers.reset();
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
