import { test } from "node:test";
import assert from "node:assert/strict";
import { ReadCache } from "../src/read-cache";
test("순위 조회 공유: 사용자 격리·동시 요청 합치기·만료·쓰기 무효화·실패 재시도", async () => {
  let now = 0,
    calls = 0;
  const cache = new ReadCache(10, () => now);
  const load = async () => ++calls;
  assert.deepEqual(
    await Promise.all([
      cache.read("student-a", load),
      cache.read("student-a", load),
    ]),
    [1, 1],
  );
  assert.equal(await cache.read("student-b", load), 2);
  assert.equal(await cache.read("student-a", load), 1);
  now = 11;
  assert.equal(await cache.read("student-a", load), 3);
  cache.clear();
  assert.equal(await cache.read("student-a", load), 4);
  let finish!: (v: number) => void;
  const pending = cache.read(
    "old",
    () => new Promise<number>((r) => (finish = r)),
  );
  await Promise.resolve();
  cache.clear();
  finish(99);
  await pending;
  assert.equal(await cache.read("old", load), 5);
  await assert.rejects(
    cache.read("error", async () => {
      throw Error("offline");
    }),
    /offline/,
  );
  assert.equal(await cache.read("error", load), 6);
});
