// Runs against a dedicated disposable Supabase TEST project, never ordinary npm test.
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const {
  TEST_ONLY,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  TEST_TEACHER_EMAIL,
  TEST_TEACHER_PASSWORD,
} = process.env;
if (
  TEST_ONLY !== "YES" ||
  ![
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    TEST_TEACHER_EMAIL,
    TEST_TEACHER_PASSWORD,
  ].every(Boolean)
)
  throw Error(
    "전용 테스트 프로젝트 환경과 TEST_ONLY=YES를 설정하세요. 실제 학생 프로젝트에서 실행하지 마세요.",
  );
const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});
const { data, error } = await auth.auth.signInWithPassword({
  email: TEST_TEACHER_EMAIL,
  password: TEST_TEACHER_PASSWORD,
});
if (error) throw error;
const jwt = data.session.access_token;
async function call(action, payload = {}, token = null) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/api`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      ...(token
        ? { "x-student-session": token }
        : { Authorization: `Bearer ${jwt}` }),
    },
    body: JSON.stringify({ action, payload }),
  });
  const body = await r.json();
  if (!r.ok) throw Error(body.error);
  return body;
}
const old = (await call("snapshot")).settings;
const suffix = crypto.randomUUID().slice(0, 8);
const fixtures = [];
try {
  await call("settings", { ...old, capacity: old.capacity + 2 });
  for (const i of [1, 2]) {
    const s = await call("student", {
      name: `테스트 ${suffix}-${i}`,
      number: `TEST-${suffix}-${i}`,
    });
    fixtures.push(s.id);
  }
  const issued = await Promise.all(
    fixtures.map((student_id) => call("code", { student_id })),
  );
  const [a, b] = await Promise.all(
    issued.map(({ code }) => call("login", { code })),
  );
  const snap = await call("snapshot", {}, a.token);
  assert.equal(snap.students.length, 1);
  assert.equal(snap.students[0].id, fixtures[0]);
  await call(
    "suggest",
    { title: "접근 검증", body: "다른 학생 비공개" },
    a.token,
  );
  assert.equal((await call("snapshot", {}, b.token)).suggestions.length, 0);
  await assert.rejects(call("code", { student_id: fixtures[1] }, a.token));
  const denied = await auth.from("student_codes").select("*");
  assert.ok(denied.error);
  let qr = await call("qr");
  const results = await Promise.allSettled(
    Array.from({ length: 12 }, () =>
      call(
        "attendance",
        { direction: "in", qr: qr.token, request_id: crypto.randomUUID() },
        a.token,
      ),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  let snapshot = await call("snapshot", {}, a.token);
  assert.equal(snapshot.visits.length, 1);
  assert.equal(snapshot.visits.filter((v) => !v.exited_at).length, 1);
  const rid = crypto.randomUUID();
  await call(
    "attendance",
    { direction: "out", qr: qr.token, request_id: rid },
    a.token,
  );
  await call(
    "attendance",
    { direction: "out", qr: qr.token, request_id: rid },
    a.token,
  );
  await call(
    "attendance",
    { direction: "in", qr: qr.token, request_id: crypto.randomUUID() },
    a.token,
  );
  assert.equal((await call("snapshot", {}, a.token)).visits.length, 2);
  await call("manual", {
    student_id: fixtures[0],
    direction: "out",
    reason: "테스트 정리",
    request_id: crypto.randomUUID(),
  });
  qr = await call("qr");
  assert.equal((await call("qr")).token, qr.token);
  const renewedQr = await call("qr_rotate");
  assert.notEqual(renewedQr.token, qr.token);
  await assert.rejects(
    call(
      "attendance",
      { direction: "in", qr: qr.token, request_id: crypto.randomUUID() },
      a.token,
    ),
    /QR/,
  );
  await call("code", { student_id: fixtures[0] });
  await assert.rejects(call("snapshot", {}, a.token));
  await call("student", {
    id: fixtures[1],
    name: `테스트 ${suffix}-2`,
    number: `TEST-${suffix}-2`,
    active: false,
  });
  await assert.rejects(call("snapshot", {}, b.token));
  console.log(
    "실제 Edge API: 권한·개인정보·동시 요청·재전송·재입실·만료 QR·접근 폐기 통과",
  );
} finally {
  for (const [i, id] of fixtures.entries()) {
    try {
      await call("student", {
        id,
        name: `테스트 ${suffix}-${i + 1}`,
        number: `TEST-${suffix}-${i + 1}`,
        active: false,
      });
    } catch {}
  }
  await call("settings", old);
  await auth.auth.signOut();
  // Audit and attendance fixtures remain for review; no destructive cleanup.
}
