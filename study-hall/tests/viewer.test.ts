import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { defaultMenus } from "../src/menu-order";

test("교사 뷰어: 코드·조회 범위·쓰기 차단·재발급·로그아웃·만료·성별 관리 권한", async () => {
  const db = new PGlite();
  try {
    // Hosted Vault encryption is replaced only in this private SQL behavior fixture.
    await db.exec(`create schema auth;create schema extensions;create schema vault;
 create role anon;create role authenticated;create role service_role;create table auth.users(id uuid primary key);
 grant usage on schema public to anon,authenticated,service_role;
 create function extensions.gen_random_uuid() returns uuid language sql as 'select gen_random_uuid()';
 create function extensions.gen_random_bytes(n integer) returns bytea language sql as 'select decode(left(replace(gen_random_uuid()::text||gen_random_uuid()::text,''-'',''''),n*2),''hex'')';
 create table vault.secrets(id uuid primary key default gen_random_uuid(),name text unique,decrypted_secret text);
 create view vault.decrypted_secrets as select * from vault.secrets;
 create function vault.create_secret(v text,n text,d text) returns uuid language sql as 'insert into vault.secrets(name,decrypted_secret) values(n,v) returning id';
 create function vault.update_secret(i uuid,v text) returns void language sql as 'update vault.secrets set decrypted_secret=v where id=i';
 create function public.code_digest(p_code text) returns text language sql as 'select encode(sha256(convert_to(upper(trim(p_code)),''UTF8'')),''hex'')';`);
    // Hosted pgcrypto HMAC is mocked; run the real validator and Vault lookup.
    await db.exec(`create function extensions.hmac(v bytea,k bytea,a text) returns bytea language sql as 'select sha256(v||k)';
      select vault.create_secret('private-test-pepper','study_hall_code_pepper','fixture');`);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    const files = fs.readdirSync(dir);
    const migration = (suffix: string) =>
      fs.readFileSync(
        new URL(
          files.find((f) => f.endsWith(suffix))!,
          dir,
        ),
        "utf8",
      );
    await db.exec(
      migration("_study_hall_initial.sql").replace(
        "create extension if not exists pgcrypto with schema extensions;",
        "",
      ),
    );
    await db.exec(migration("_student_gender_groups.sql"));
    await db.exec(migration("_teacher_viewer_access.sql"));
    await db.exec(migration("_student_gender_form.sql"));
    await db.exec(migration("_short_login_codes.sql"));
    await db.exec(migration("_five_character_code_digest.sql"));
    await db.exec(migration("_student_soft_delete.sql"));
    await db.exec(migration("_student_code_lookup.sql"));
    await db.exec(migration("_attendance_record_delete.sql"));
    await db.exec(migration("_editable_login_copy.sql"));
    await db.exec(migration("_seat_pairs_warning_cards.sql"));
    await db.exec(migration("_warning_card_delete.sql"));
    await db.exec(migration("_teacher_warning_permissions.sql"));
    await db.exec(migration("_teacher_seat_gender.sql"));
    await db.exec(migration("_bulk_attendance_delete.sql"));
    await db.exec(migration("_supervision_schedule.sql"));
    await db.exec(migration("_seat_sheet_sync.sql"));
    await db.exec(migration("_roster_sheet_import.sql"));
    await db.exec(migration("_cleaning_schedule.sql"));
    await db.exec(migration("_cleaning_notice.sql"));
    await db.exec(migration("_student_weekly_rank.sql"));
    await db.exec(migration("_role_menu_order.sql"));
    await db.exec(migration("_period_attendance.sql"));
    await db.exec(migration("_attendance_summary.sql"));
    await db.exec(migration("_ranking_collections.sql"));
    await db.exec(migration("_student_polls.sql"));
    await assert.rejects(db.query("select code_digest('AB12')"), /형식/);
    const admin = crypto.randomUUID(),
      outsider = crypto.randomUUID(),
      student = crypto.randomUUID();
    await db.query("insert into auth.users values($1),($2)", [admin, outsider]);
    await db.query("insert into admins values($1)", [admin]);
    const getCopy = async () =>
      (await db.query<{ r: any }>("select get_site_copy() r")).rows[0].r;
    const setCopy = async (who: string | null, copy: any) =>
      db.query("select set_site_copy($1,$2)", [who, JSON.stringify(copy)]);
    const originalCopy = await getCopy();
    assert.equal(Object.keys(originalCopy).length, 6);
    await assert.rejects(setCopy(null, originalCopy), /관리자/);
    await assert.rejects(setCopy(outsider, originalCopy), /관리자/);
    await assert.rejects(
      setCopy(admin, { ...originalCopy, unexpected: "extra" }),
      /항목/,
    );
    await assert.rejects(
      setCopy(admin, { ...originalCopy, hero_title: 23 }),
      /문구/,
    );
    await setCopy(admin, {
      ...originalCopy,
      hero_title: "테스트 제목\n다음 줄",
      production_badge: "",
    });
    assert.equal((await getCopy()).hero_title, "테스트 제목\n다음 줄");
    assert.equal((await getCopy()).production_badge, "");
    await db.exec(migration("_editable_ranking_message.sql"));
    const upgradedCopy = await getCopy();
    assert.equal(upgradedCopy.hero_title, "테스트 제목\n다음 줄");
    assert.match(upgradedCopy.ranking_encouragement, /\n\n조급해/);
    assert.ok(upgradedCopy.ranking_encouragement.endsWith("응원합니다!"));
    await assert.rejects(setCopy(outsider, upgradedCopy), /관리자/);
    await assert.rejects(
      setCopy(admin, { ...upgradedCopy, ranking_encouragement: 42 }),
      /응원 문구/,
    );
    await assert.rejects(
      setCopy(admin, {
        ...upgradedCopy,
        ranking_encouragement: "가".repeat(2001),
      }),
      /2000/,
    );
    await setCopy(admin, {
      ...upgradedCopy,
      ranking_encouragement: "첫 문단\n\n둘째 문단!",
    });
    await setCopy(admin, originalCopy);
    assert.equal(
      (await getCopy()).ranking_encouragement,
      "첫 문단\n\n둘째 문단!",
    );
    await setCopy(admin, { ...upgradedCopy, ranking_encouragement: "" });
    assert.equal((await getCopy()).ranking_encouragement, "");
    await db.query(
      "insert into students(id,name,number,seat_id) values($1,'가상학생','D001',1)",
      [student],
    );
    await db.query(
      "insert into suggestions(student_id,title,body) values($1,'비공개','숨김')",
      [student],
    );
    const access = async (who: string | null, rotate = false) =>
      (
        await db.query<{ r: any }>("select teacher_access($1,$2) r", [
          who,
          rotate,
        ])
      ).rows[0].r;
    const api = async (
      action: string,
      payload: any = {},
      session: string | null = null,
    ) =>
      (
        await db.query<{ r: any }>("select teacher_viewer_api($1,$2,$3) r", [
          action,
          JSON.stringify(payload),
          session,
        ])
      ).rows[0].r;
    const login = async (code: string, token: string) => {
      const hash = (
        await db.query<{ h: string }>("select code_digest($1) h", [code])
      ).rows[0].h;
      return api("login", { code_hash: hash, token_hash: token });
    };
    await assert.rejects(access(null), /관리자/);
    await assert.rejects(access(outsider), /관리자/);
    const code = (await access(admin)).code;
    assert.match(code, /^[A-HJ-NP-Z2-9]{5}$/);
    assert.match(code, /[A-Z]/);
    assert.match(code, /[2-9]/);
    assert.equal((await access(admin)).code, code);
    await assert.rejects(login("WRONG", "a".repeat(64)), /코드/);
    await login(code, "a".repeat(64));
    const data = await api("snapshot", {}, "a".repeat(64));
    assert.equal(data.students.length, 1);
    assert.equal(data.students[0].gender, "unknown");
    assert.equal(data.students[0].deleted_at, null);
    assert.equal(data.seats.length, 72);
    assert.equal(data.suggestions.length, 1);
    assert.deepEqual(data.audits, []);
    assert.equal(JSON.stringify(data).includes("code_hash"), false);
    for (const action of [
      "student",
      "student_gender",
      "assign",
      "manual",
      "attendance",
      "correct",
      "qr",
      "teacher_code",
      "notice",
      "reply",
      "settings",
    ])
      await assert.rejects(api(action, {}, "a".repeat(64)), /조회/);
    await assert.rejects(
      db.query("select app_api('snapshot','{}',null,$1)", ["a".repeat(64)]),
      /세션/,
    );
    const changed = (await access(admin, true)).code;
    assert.notEqual(changed, code);
    await assert.rejects(api("snapshot", {}, "a".repeat(64)), /세션/);
    await assert.rejects(login(code, "b".repeat(64)), /코드/);
    await login(changed, "b".repeat(64));
    await api("logout", {}, "b".repeat(64));
    await assert.rejects(api("snapshot", {}, "b".repeat(64)), /세션/);
    await login(changed, "c".repeat(64));
    await db.exec(
      "update teacher_viewer_sessions set expires_at=now()-interval '1 minute'",
    );
    await assert.rejects(api("snapshot", {}, "c".repeat(64)), /세션/);
    const gender = async (who: string | null, ids: string[], value: string) =>
      db.query("select set_student_gender($1,$2,$3)", [who, ids, value]);
    await assert.rejects(gender(outsider, [student], "male"), /관리자/);
    await assert.rejects(gender(null, [student], "female"), /관리자/);
    await assert.rejects(gender(admin, [student], "bad"), /성별/);
    await assert.rejects(
      gender(admin, [student, crypto.randomUUID()], "male"),
      /학생/,
    );
    assert.equal(
      (await db.query<{ gender: string }>("select gender from students"))
        .rows[0].gender,
      "unknown",
    );
    await gender(admin, [student], "male");
    assert.equal(
      (await db.query<{ gender: string }>("select gender from students"))
        .rows[0].gender,
      "male",
    );
    await login((await access(admin)).code, "d".repeat(64));
    assert.equal(
      (await api("snapshot", {}, "d".repeat(64))).students[0].gender,
      "male",
    );
    const save = async (who: string | null, payload: any) =>
      (
        await db.query<{ r: any }>("select save_student($1,$2) r", [
          who,
          JSON.stringify(payload),
        ])
      ).rows[0].r;
    await assert.rejects(
      save(null, { name: "차단학생", number: "D002", gender: "female" }),
      /관리자/,
    );
    await save(admin, {
      id: student,
      name: "가상학생 수정",
      number: "D001",
      active: true,
      gender: "female",
    });
    await assert.rejects(
      save(admin, {
        id: student,
        name: "잘못된 수정",
        number: "D001",
        active: true,
        gender: "invalid",
      }),
      /성별/,
    );
    assert.deepEqual(
      (
        await db.query("select name,gender from students where id=$1", [
          student,
        ])
      ).rows[0],
      { name: "가상학생 수정", gender: "female" },
    );
    await save(admin, {
      id: student,
      name: "가상학생 수정",
      number: "D001",
      active: true,
    });
    assert.equal(
      (
        await db.query<{ gender: string }>(
          "select gender from students where id=$1",
          [student],
        )
      ).rows[0].gender,
      "female",
    );
    const another = (
      await save(admin, { name: "가상학생 2", number: "D002", gender: "male" })
    ).id;
    const issue = async (who: string | null, id: string) =>
      (
        await db.query<{ r: any }>("select issue_student_code($1,$2) r", [
          who,
          id,
        ])
      ).rows[0].r.code;
    await assert.rejects(issue(outsider, student), /관리자/);
    const first = await issue(admin, student),
      second = await issue(admin, another);
    const lookup = async (who: string | null, id: string) =>
      (await db.query<{ r: any }>("select student_code($1,$2) r", [who, id]))
        .rows[0].r.code;
    assert.equal(await lookup(admin, student), first);
    await assert.rejects(lookup(null, student), /관리자/);
    await assert.rejects(lookup(outsider, student), /관리자/);
    for (const value of [first, second]) {
      assert.match(value, /^[A-HJ-NP-Z2-9]{5}$/);
      assert.match(value, /[A-Z]/);
      assert.match(value, /[2-9]/);
      assert.notEqual(value, changed);
    }
    assert.notEqual(first, second);
    const studentLogin = async (value: string) =>
      db.query(
        "select app_api('login',jsonb_build_object('code_hash',code_digest($1),'token_hash',$2::text),null,null)",
        [value, "d".repeat(64)],
      );
    await studentLogin(first.toLowerCase());
    const renewed = await issue(admin, student);
    assert.equal(await lookup(admin, student), renewed);
    assert.notEqual(renewed, first);
    await assert.rejects(studentLogin(first), /코드/);
    await assert.rejects(
      db.query("select app_api('snapshot','{}',null,$1)", ["d".repeat(64)]),
      /세션/,
    );
    const remove = async (who: string | null, id: string) =>
      db.query("select delete_student($1,$2)", [who, id]);
    await assert.rejects(remove(null, another), /관리자/);
    await assert.rejects(remove(outsider, another), /관리자/);
    await db.query("update students set seat_id=2 where id=$1", [another]);
    await db.query("insert into visits(student_id) values($1)", [another]);
    await assert.rejects(remove(admin, another), /퇴실/);
    assert.equal(
      (
        await db.query<{ active: boolean }>(
          "select active from students where id=$1",
          [another],
        )
      ).rows[0].active,
      true,
    );
    await db.query("update visits set exited_at=now() where student_id=$1", [
      another,
    ]);
    await studentLogin(second);
    await remove(admin, another);
    await remove(admin, another);
    const deleted = (
      await db.query<{
        active: boolean;
        seat_id: number | null;
        deleted_at: string;
      }>("select active,seat_id,deleted_at from students where id=$1", [
        another,
      ])
    ).rows[0];
    assert.equal(deleted.active, false);
    assert.equal(deleted.seat_id, null);
    assert.ok(deleted.deleted_at);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from visits where student_id=$1",
          [another],
        )
      ).rows[0].n,
      1,
    );
    await assert.rejects(studentLogin(second), /코드/);
    await assert.rejects(
      db.query("select app_api('snapshot','{}',null,$1)", ["d".repeat(64)]),
      /세션/,
    );
    await assert.rejects(
      save(admin, {
        id: another,
        name: "복구시도",
        number: "D002",
        active: true,
      }),
      /삭제/,
    );
    await assert.rejects(issue(admin, another), /학생/);
    await assert.rejects(lookup(admin, another), /학생/);
    const visit = (
      await db.query<{ id: string }>(
        "select id from visits where student_id=$1",
        [another],
      )
    ).rows[0].id;
    const deleteVisit = async (who: string | null, reason: string) =>
      db.query("select delete_visit($1,$2,$3)", [who, visit, reason]);
    await assert.rejects(deleteVisit(null, "테스트"), /관리자/);
    await assert.rejects(deleteVisit(outsider, "테스트"), /관리자/);
    await assert.rejects(deleteVisit(admin, " "), /사유/);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from visits where id=$1",
          [visit],
        )
      ).rows[0].n,
      1,
    );
    await deleteVisit(admin, "중복 출결 정리");
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from visits where id=$1",
          [visit],
        )
      ).rows[0].n,
      0,
    );
    const audit = (
      await db.query<{ before_value: any; reason: string }>(
        "select before_value,reason from audits where kind='visit_delete'",
      )
    ).rows[0];
    assert.equal(audit.before_value.id, visit);
    assert.match(audit.reason, /중복 출결 정리/);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from vault.secrets where name=$1",
          ["study_hall_student_code_" + another],
        )
      ).rows[0].n,
      0,
    );
    // Batch delete must validate the whole selection before deleting anything.
    const bulkIds = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    await db.query(
      "insert into visits(id,student_id,entered_at,exited_at) values($1,$4,'2026-10-14T09:00:00Z','2026-10-14T10:00:00Z'),($2,$5,'2026-10-14T09:00:00Z',null),($3,$4,'2026-10-14T11:00:00Z','2026-10-14T12:00:00Z')",
      [...bulkIds, student, another],
    );
    const bulkDelete = (
      who: string | null,
      ids: (string | null)[],
      reason = "선택 정리",
    ) =>
      db.query<{ r: any }>("select delete_visits($1,$2,$3) r", [
        who,
        ids,
        reason,
      ]);
    await assert.rejects(bulkDelete(null, bulkIds), /관리자/);
    await assert.rejects(bulkDelete(outsider, bulkIds), /관리자/);
    await assert.rejects(bulkDelete(admin, bulkIds, " "), /사유/);
    await assert.rejects(bulkDelete(admin, []), /선택/);
    await assert.rejects(bulkDelete(admin, [null]), /선택/);
    await assert.rejects(bulkDelete(admin, [bulkIds[0], bulkIds[0]]), /선택/);
    await assert.rejects(
      bulkDelete(admin, Array(1001).fill(bulkIds[0])),
      /선택/,
    );
    await assert.rejects(
      bulkDelete(admin, [bulkIds[0], crypto.randomUUID()]),
      /없는 기록/,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from visits where id=any($1)",
          [bulkIds],
        )
      ).rows[0].n,
      3,
    );
    assert.equal(
      (await bulkDelete(admin, bulkIds.slice(0, 2))).rows[0].r.deleted,
      2,
    );
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from visits where id=any($1)",
          [bulkIds],
        )
      ).rows[0].n,
      1,
    );
    const bulkAudits = (
      await db.query<{ before_value: any; reason: string }>(
        "select before_value,reason from audits where kind='visit_delete_bulk'",
      )
    ).rows;
    assert.equal(bulkAudits.length, 2);
    assert.ok(
      bulkAudits.every(
        (a) =>
          a.reason.includes("선택 정리") &&
          bulkIds.slice(0, 2).includes(a.before_value.id),
      ),
    );
    assert.ok(bulkAudits.some((a) => a.before_value.exited_at === null));
    // No live records: verify append-only cards and scoped reads in this private DB.
    const warningStudent = crypto.randomUUID(),
      otherStudent = crypto.randomUUID();
    await db.query(
      "insert into students(id,name,number,gender) values($1,'경고테스트','W001','male'),($2,'다른학생','W002','female')",
      [warningStudent, otherStudent],
    );
    const warn = async (
      who: string | null,
      target: string,
      reason: string,
      request = crypto.randomUUID(),
    ) =>
      db.query("select issue_warning($1,$2,$3,$4)", [
        who,
        target,
        reason,
        request,
      ]);
    await assert.rejects(warn(null, warningStudent, "테스트"), /관리자/);
    await assert.rejects(warn(outsider, warningStudent, "테스트"), /관리자/);
    await assert.rejects(warn(admin, warningStudent, " "), /사유/);
    const request = crypto.randomUUID();
    await warn(admin, warningStudent, "소란", request);
    await warn(admin, warningStudent, "소란", request);
    await warn(admin, warningStudent, "지각");
    await warn(admin, otherStudent, "별도 내역");
    await assert.rejects(
      warn(admin, otherStudent, "소란", request),
      /요청 번호/,
    );
    const snap = async (
      who: string | null,
      session: string | null = null,
      viewer: string | null = null,
    ) =>
      (
        await db.query<{ r: any }>(
          "select snapshot_with_warnings($1,$2,$3) r",
          [who, session, viewer],
        )
      ).rows[0].r;
    assert.equal((await snap(admin)).warnings.length, 3);
    assert.equal(
      (await snap(admin)).warnings.filter(
        (w: any) => w.student_id === warningStudent,
      ).length,
      2,
    );
    await login((await access(admin)).code, "e".repeat(64));
    assert.equal((await snap(null, null, "e".repeat(64))).warnings.length, 3);
    await assert.rejects(snap(null, null, "invalid"), /세션/);
    await db.query("insert into student_codes values($1,'fixture',1)", [
      warningStudent,
    ]);
    await db.query(
      "insert into student_sessions values($1,$2,1,now()+interval '1 hour')",
      ["f".repeat(64), warningStudent],
    );
    const privateSnapshot = await snap(null, "f".repeat(64));
    assert.equal(privateSnapshot.warnings.length, 2);
    assert.ok(
      privateSnapshot.warnings.every(
        (w: any) => w.student_id === warningStudent && !("actor" in w),
      ),
    );
    await assert.rejects(snap(outsider), /권한/);
    const deleteWarning = (
      who: string | null,
      card = request,
      reason = "잘못 발급",
    ) => db.query("select delete_warning($1,$2,$3)", [who, card, reason]);
    await assert.rejects(deleteWarning(null), /관리자/);
    await assert.rejects(deleteWarning(outsider), /관리자/);
    await assert.rejects(deleteWarning(admin, request, " "), /사유/);
    await assert.rejects(deleteWarning(admin, crypto.randomUUID()), /찾을/);
    await deleteWarning(admin);
    await deleteWarning(admin);
    assert.equal((await snap(admin)).warnings.length, 2);
    assert.equal((await snap(null, "f".repeat(64))).warnings.length, 1);
    assert.equal((await snap(null, null, "e".repeat(64))).warnings.length, 2);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from audits where kind='warning_delete'",
        )
      ).rows[0].n,
      1,
    );
    const removedCard = (
      await db.query<{ reason: string; deleted_at: string }>(
        "select reason,deleted_at from warning_cards where id=$1",
        [request],
      )
    ).rows[0];
    assert.equal(removedCard.reason, "소란");
    assert.ok(removedCard.deleted_at);

    const teacherWarning = async (
      action: string,
      payload: any,
      session = "e".repeat(64),
    ) =>
      db.query("select teacher_warning_api($1,$2,$3)", [
        action,
        JSON.stringify(payload),
        session,
      ]);
    const teacherRequest = crypto.randomUUID();
    const teacherPayload = {
      student_id: warningStudent,
      request_id: teacherRequest,
      reason: "교사 발급",
    };
    await assert.rejects(
      teacherWarning("warning_issue", teacherPayload, "f".repeat(64)),
      /세션/,
    );
    await assert.rejects(
      teacherWarning("warning_issue", teacherPayload, "invalid"),
      /세션/,
    );
    await assert.rejects(teacherWarning("assign", teacherPayload), /경고카드/);
    await assert.rejects(
      teacherWarning("warning_issue", { ...teacherPayload, reason: " " }),
      /사유/,
    );
    await teacherWarning("warning_issue", teacherPayload);
    await teacherWarning("warning_issue", teacherPayload);
    assert.equal((await snap(admin)).warnings.length, 3);
    const teacherCard = (
      await db.query<{ actor: string | null; actor_role: string }>(
        "select actor,actor_role from warning_cards where id=$1",
        [teacherRequest],
      )
    ).rows[0];
    assert.equal(teacherCard.actor, null);
    assert.equal(teacherCard.actor_role, "teacher");
    await teacherWarning("warning_delete", {
      id: teacherRequest,
      reason: "교사 삭제",
    });
    await teacherWarning("warning_delete", {
      id: teacherRequest,
      reason: "교사 삭제",
    });
    assert.equal((await snap(admin)).warnings.length, 2);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from teacher_warning_events where card_id=$1",
          [teacherRequest],
        )
      ).rows[0].n,
      2,
    );
    const adminCard = (
      await db.query<{ id: string }>(
        "select id from warning_cards where student_id=$1 and deleted_at is null",
        [warningStudent],
      )
    ).rows[0].id;
    await teacherWarning("warning_delete", {
      id: adminCard,
      reason: "관리자 발급 카드 정정",
    });
    assert.equal((await snap(null, "f".repeat(64))).warnings.length, 0);
    await db.exec(
      "update teacher_viewer_sessions set expires_at=now()-interval '1 minute'",
    );
    await assert.rejects(
      teacherWarning("warning_issue", {
        ...teacherPayload,
        request_id: crypto.randomUUID(),
      }),
      /세션/,
    );
    await db.exec(
      "update teacher_viewer_sessions set expires_at=now()+interval '1 hour'",
    );
    await access(admin, true);
    await assert.rejects(
      teacherWarning("warning_issue", teacherPayload),
      /세션/,
    );

    // Atomic pair guard rejects a mixed preview without leaving assignments/history behind.
    await db.exec("update students set seat_id=null");
    const assign = async (who: string | null, pairs: any[]) =>
      db.query("select assign_seats($1,$2)", [
        who,
        JSON.stringify({ pairs, same_gender_pairs: true }),
      ]);
    const mixed = [
      { student_id: warningStudent, seat_id: 1 },
      { student_id: otherStudent, seat_id: 2 },
    ];
    await assert.rejects(assign(null, mixed), /관리자/);
    await assert.rejects(assign(admin, mixed), /같은 성별/);
    assert.equal(
      (
        await db.query<{ n: number }>(
          "select count(*)::int n from students where seat_id is not null",
        )
      ).rows[0].n,
      0,
    );
    await assign(admin, [
      { student_id: warningStudent, seat_id: 1 },
      { student_id: otherStudent, seat_id: 4 },
    ]);
    const supervision = async (
      action: string,
      payload: any = {},
      who: string | null = null,
      viewer: string | null = null,
    ) =>
      (
        await db.query<{ r: any }>("select supervision_api($1,$2,$3,$4) r", [
          action,
          JSON.stringify(payload),
          who,
          viewer,
        ])
      ).rows[0].r;
    const schedule = [
      {
        day: "2026-10-16",
        period: 1,
        week_label: "1주차",
        teacher_name: "가상교사 A",
        status: "assigned",
        note: "",
        revision: 0,
      },
      {
        day: "2026-10-16",
        period: 7,
        week_label: "1주차",
        teacher_name: "",
        status: "closed",
        note: "",
        revision: 0,
      },
    ];
    await assert.rejects(supervision("read"), /권한/);
    await assert.rejects(supervision("read", {}, outsider), /권한/);
    await assert.rejects(supervision("read", {}, null, "f".repeat(64)), /권한/);
    await supervision("save", { slots: schedule }, admin);
    await login((await access(admin)).code, "6".repeat(64));
    assert.equal(
      (await supervision("read", {}, null, "6".repeat(64))).length,
      2,
    );
    await assert.rejects(
      supervision("save", { slots: schedule }, null, "6".repeat(64)),
      /관리자/,
    );
    assert.equal("supervision" in (await snap(null, "f".repeat(64))), false);
    assert.equal(
      JSON.stringify(await snap(null, "f".repeat(64))).includes("가상교사 A"),
      false,
    );
    const current = (await supervision("read", {}, admin))[0];
    await supervision(
      "save",
      { slots: [{ ...current, teacher_name: "가상교사 B", note: "교체" }] },
      admin,
    );
    await assert.rejects(
      supervision(
        "save",
        { slots: [{ ...current, teacher_name: "과거 화면" }] },
        admin,
      ),
      /다른 변경/,
    );
    const latest = (await supervision("read", {}, admin))[0];
    assert.equal(latest.teacher_name, "가상교사 B");
    assert.equal(latest.revision, 2);
    await assert.rejects(
      supervision(
        "save",
        {
          slots: [
            { ...latest, teacher_name: "롤백 대상" },
            { ...schedule[1], period: 8 },
          ],
        },
        admin,
      ),
    );
    assert.equal(
      (await supervision("read", {}, admin))[0].teacher_name,
      "가상교사 B",
    );
    await assert.rejects(
      supervision("save", { slots: [latest, latest] }, admin),
      /중복/,
    );
    await api("logout", {}, "6".repeat(64));
    await assert.rejects(supervision("read", {}, null, "6".repeat(64)), /권한/);
    const sheetSync = async (
      who: string | null,
      action: string,
      payload: any = {},
    ) =>
      (
        await db.query<{ r: any }>("select seat_sheet_sync($1,$2,$3) r", [
          who,
          action,
          JSON.stringify(payload),
        ])
      ).rows[0].r;
    await assert.rejects(sheetSync(null, "status"), /관리자/);
    await assert.rejects(sheetSync(outsider, "prepare"), /관리자/);
    assert.equal((await sheetSync(admin, "status")).configured, false);
    await db.exec(
      "insert into seat_sheet_sync_config(id,spreadsheet_id,target_sheet_id) values(true,'fixture-workbook',123)",
    );
    const syncCredentials = await sheetSync(admin, "prepare");
    assert.match(syncCredentials.secret, /^[a-f0-9]{64}$/);
    assert.equal(
      (await sheetSync(admin, "prepare")).secret,
      syncCredentials.secret,
    );
    assert.equal(
      JSON.stringify(await sheetSync(admin, "status")).includes(
        syncCredentials.secret,
      ),
      false,
    );
    await assert.rejects(
      sheetSync(admin, "configure", { endpoint: "https://evil.test/exec" }),
      /올바른/,
    );
    await sheetSync(admin, "configure", {
      endpoint: "https://script.google.com/macros/s/fixture/exec",
    });
    assert.equal((await sheetSync(admin, "status")).configured, true);
    const syncSource = await sheetSync(admin, "payload");
    assert.equal(syncSource.seats.length, 72);
    assert.equal(JSON.stringify(syncSource).includes("code_hash"), false);
    await assert.rejects(
      sheetSync(admin, "record", { updated: 0 }),
      /반영 결과/,
    );
    await sheetSync(admin, "record", {
      updated: 72,
      before: [{ seat_id: 1, formula: "=fixture" }],
      request_id: crypto.randomUUID(),
    });
    assert.ok((await sheetSync(admin, "status")).last_synced_at);
    const syncAudit = (
      await db.query<{ before_value: any; after_value: any }>(
        "select before_value,after_value from audits where kind='sheet_seat_sync'",
      )
    ).rows[0];
    assert.equal(syncAudit.before_value[0].formula, "=fixture");
    assert.equal(
      JSON.stringify(syncAudit).includes(syncCredentials.secret),
      false,
    );
    const importRows = async (who: string | null, rows: any[]) =>
      (
        await db.query<{ r: any }>("select import_roster_students($1,$2) r", [
          who,
          JSON.stringify(rows),
        ])
      ).rows[0].r;
    await assert.rejects(
      importRows(null, [{ number: "39901", name: "신규" }]),
      /관리자/,
    );
    await assert.rejects(
      importRows(admin, [{ number: "39901", name: "" }]),
      /학번/,
    );
    await assert.rejects(
      importRows(admin, [
        { number: "39901", name: "신규" },
        { number: "39901", name: "중복" },
      ]),
      /중복/,
    );
    const created = await importRows(admin, [
      { number: "39901", name: "신규" },
    ]);
    assert.equal(created.added, 1);
    const saved = (
      await db.query<any>("select * from students where number='39901'")
    ).rows[0];
    const codeBefore = (
      await db.query<any>("select * from student_codes where student_id=$1", [
        saved.id,
      ])
    ).rows[0];
    assert.equal(saved.seat_id, null);
    assert.equal(saved.gender, "unknown");
    const repeated = await importRows(admin, [
      { number: "39901", name: "덮어쓰면 안됨" },
    ]);
    assert.equal(repeated.added, 0);
    assert.equal(repeated.skipped, 1);
    assert.equal(
      (await db.query<any>("select name from students where id=$1", [saved.id]))
        .rows[0].name,
      "신규",
    );
    assert.deepEqual(
      (
        await db.query<any>("select * from student_codes where student_id=$1", [
          saved.id,
        ])
      ).rows[0],
      codeBefore,
    );
    await db.exec(
      "update students set deleted_at=now(),active=false where number='39901'",
    );
    assert.equal(
      (await importRows(admin, [{ number: "39901", name: "복원 금지" }])).added,
      0,
    );
    const cleaningApi = async (
      action: string,
      payload: any = {},
      who: string | null = admin,
      viewerToken: string | null = null,
      studentToken: string | null = null,
    ) =>
      (
        await db.query<{ r: any }>("select cleaning_api($1,$2,$3,$4,$5) r", [
          action,
          JSON.stringify(payload),
          who,
          viewerToken,
          studentToken,
        ])
      ).rows[0].r;
    await assert.rejects(cleaningApi("read", {}, null), /로그인/);
    await assert.rejects(cleaningApi("read", {}, outsider), /로그인/);
    const cleaner = crypto.randomUUID();
    await db.query(
      "insert into students(id,number,name) values($1,'39801','청소 테스트')",
      [cleaner],
    );
    await db.query("select issue_student_code($1,$2)", [admin, cleaner]);
    await db.query(
      "insert into student_sessions(token_hash,student_id,version,expires_at) select $1,student_id,version,now()+interval '1 hour' from student_codes where student_id=$2",
      ["c".repeat(64), cleaner],
    );
    assert.deepEqual(await cleaningApi("read"), []);
    const freshViewerCode = (await access(admin)).code;
    await login(freshViewerCode, "d".repeat(64));
    assert.deepEqual(await cleaningApi("read", {}, null, "d".repeat(64)), []);
    await assert.rejects(
      cleaningApi("save", { slots: [] }, null, "d".repeat(64)),
      /관리자/,
    );
    const slot = {
      day: "2026-10-21",
      student_ids: [cleaner],
      note: "바닥 정리",
      revision: 0,
    };
    await cleaningApi("save", { slots: [slot] });
    const read = await cleaningApi("read", {}, null, null, "c".repeat(64));
    assert.equal(read[0].students[0].number, "39801");
    assert.deepEqual(Object.keys(read[0].students[0]).sort(), [
      "id",
      "name",
      "number",
    ]);
    await assert.rejects(
      cleaningApi("save", { slots: [slot] }, null, null, "c".repeat(64)),
      /관리자/,
    );
    await assert.rejects(
      cleaningApi(
        "delete",
        { day: slot.day, revision: 1 },
        null,
        null,
        "c".repeat(64),
      ),
      /관리자/,
    );
    await assert.rejects(cleaningApi("save", { slots: [slot] }), /다른 변경/);
    await assert.rejects(
      cleaningApi("save", {
        slots: [
          { ...slot, day: "2026-10-23", student_ids: [cleaner, cleaner] },
        ],
      }),
      /중복/,
    );
    await assert.rejects(
      cleaningApi("save", {
        slots: [
          { ...slot, day: "2026-10-23", student_ids: [crypto.randomUUID()] },
        ],
      }),
      /학생/,
    );
    await assert.rejects(
      cleaningApi("save", {
        slots: [
          { ...slot, day: "2026-10-23" },
          { ...slot, day: "2026-10-28", student_ids: [crypto.randomUUID()] },
        ],
      }),
      /학생/,
    );
    assert.equal((await cleaningApi("read")).length, 1);
    await cleaningApi("save", {
      slots: [{ ...slot, revision: 1, note: "수정" }],
    });
    await assert.rejects(
      cleaningApi("delete", { day: slot.day, revision: 1 }),
      /다른 변경/,
    );
    await cleaningApi("delete", { day: slot.day, revision: 2 });
    assert.deepEqual(await cleaningApi("read"), []);
    await db.exec(
      "update student_sessions set expires_at=now()-interval '1 second' where token_hash=repeat('c',64)",
    );
    await assert.rejects(
      cleaningApi("read", {}, null, null, "c".repeat(64)),
      /로그인/,
    );
    const cleaningNotice = async (
      action: string,
      payload: any = {},
      who: string | null = admin,
      viewerToken: string | null = null,
      studentToken: string | null = null,
    ) =>
      (
        await db.query<{ r: any }>(
          "select cleaning_notice_api($1,$2,$3,$4,$5) r",
          [action, JSON.stringify(payload), who, viewerToken, studentToken],
        )
      ).rows[0].r;
    await assert.rejects(cleaningNotice("read", {}, null), /로그인/);
    const initialNotice = await cleaningNotice("read");
    assert.match(initialNotice.body, /3학년부/);
    assert.deepEqual(
      await cleaningNotice("read", {}, null, "d".repeat(64)),
      initialNotice,
    );
    await assert.rejects(
      cleaningNotice(
        "save",
        { body: "위조", revision: 1 },
        null,
        "d".repeat(64),
      ),
      /관리자/,
    );
    await db.exec(
      "update student_sessions set expires_at=now()+interval '1 hour' where token_hash=repeat('c',64)",
    );
    assert.deepEqual(
      await cleaningNotice("read", {}, null, null, "c".repeat(64)),
      initialNotice,
    );
    await assert.rejects(
      cleaningNotice(
        "save",
        { body: "위조", revision: 1 },
        null,
        null,
        "c".repeat(64),
      ),
      /관리자/,
    );
    await assert.rejects(
      cleaningNotice("save", { body: " ", revision: 1 }),
      /1~3000/,
    );
    const changedNotice = await cleaningNotice("save", {
      body: "수정된 안내\n환기하세요.",
      revision: 1,
    });
    assert.equal(changedNotice.revision, 2);
    assert.match(changedNotice.body, /환기/);
    await assert.rejects(
      cleaningNotice("save", { body: "이전 버전", revision: 1 }),
      /다른 변경/,
    );
    const menuApi = async (
      action: string,
      payload: any = {},
      who: string | null = admin,
      viewerToken: string | null = null,
      studentToken: string | null = null,
    ) =>
      (
        await db.query<{ r: any }>("select menu_order_api($1,$2,$3,$4,$5) r", [
          action,
          JSON.stringify(payload),
          who,
          viewerToken,
          studentToken,
        ])
      ).rows[0].r;
    const orders = Object.fromEntries(
      Object.entries(defaultMenus).map(([r, items]) => [
        r,
        items.map((m) => m[0]).reverse(),
      ]),
    );
    await assert.rejects(menuApi("read", {}, null), /로그인/);
    await assert.rejects(
      menuApi("save", { orders, revision: 1 }, null, "d".repeat(64)),
      /관리자/,
    );
    await assert.rejects(
      menuApi("save", { orders, revision: 1 }, null, null, "c".repeat(64)),
      /관리자/,
    );
    const menuRevision = (await menuApi("read")).revision;
    const nav = await menuApi("save", { orders, revision: menuRevision });
    assert.deepEqual(nav.orders, orders);
    assert.equal(nav.revision, menuRevision + 1);
    assert.deepEqual(
      await menuApi("read", {}, null, null, "c".repeat(64)),
      nav,
    );
    assert.deepEqual(await menuApi("read", {}, null, "d".repeat(64)), nav);
    await assert.rejects(menuApi("save", { orders, revision: 1 }), /다른 변경/);
    await assert.rejects(
      menuApi("save", {
        orders: {
          ...orders,
          student: [...orders.student.slice(1), "settings"],
        },
        revision: 2,
      }),
      /허용/,
    );
    await assert.rejects(
      menuApi("save", {
        orders: { ...orders, student: orders.student.slice(1) },
        revision: 2,
      }),
      /빠짐없이/,
    );
    await assert.rejects(
      menuApi("save", {
        orders: { ...orders, student: orders.student.map(() => "home") },
        revision: 2,
      }),
      /중복/,
    );
    // Pin server time only in this fixture to test Friday/Saturday and next-week boundaries.
    const rankMigration = migration("_student_weekly_rank.sql").replace(
      "create function",
      "create or replace function",
    );
    await db.exec(
      rankMigration.replaceAll(
        "now()",
        "'2026-10-18T23:00:00+09:00'::timestamptz",
      ),
    );
    await db.exec(
      "update student_sessions set expires_at='2099-01-01';update teacher_viewer_sessions set expires_at='2099-01-01'",
    );
    const rankPeer = crypto.randomUUID();
    await db.query(
      "insert into students(id,number,name) values($1,'39802','동점 학생')",
      [rankPeer],
    );
    await db.query(
      "insert into visits(student_id,entered_at,exited_at) values($1,'2026-10-12T10:00:00+09:00','2026-10-12T11:00:00+09:00'),($1,'2026-10-16T23:30:00+09:00','2026-10-17T00:30:00+09:00'),($1,'2026-10-17T10:00:00+09:00','2026-10-17T11:00:00+09:00'),($2,'2026-10-13T10:00:00+09:00','2026-10-13T11:30:00+09:00')",
      [cleaner, rankPeer],
    );
    const rankRead = async (
      who: string | null = admin,
      viewerToken: string | null = null,
      studentToken: string | null = null,
    ) =>
      (
        await db.query<{ r: any }>("select weekly_ranking($1,$2,$3) r", [
          who,
          viewerToken,
          studentToken,
        ])
      ).rows[0].r;
    await assert.rejects(rankRead(null), /로그인/);
    await assert.rejects(rankRead(outsider), /로그인/);
    const teacherRanks = await rankRead();
    assert.ok(Array.isArray(teacherRanks.rows));
    assert.deepEqual(await rankRead(null, "d".repeat(64)), teacherRanks);
    const privateRank = await rankRead(null, null, "c".repeat(64));
    assert.equal(privateRank.rows, undefined);
    assert.deepEqual(Object.keys(privateRank.mine).sort(), [
      "rank",
      "seconds",
      "tied",
    ]);
    assert.equal(privateRank.mine.seconds, 5400);
    assert.equal(privateRank.mine.tied, true);
    const peerRank = teacherRanks.rows.find((r: any) => r.id === rankPeer);
    assert.equal(privateRank.mine.rank, peerRank.rank);
    assert.deepEqual(
      teacherRanks.rows.find((r: any) => r.id === cleaner).seconds,
      5400,
    );
    await db.exec(
      rankMigration.replaceAll(
        "now()",
        "'2026-10-19T12:00:00+09:00'::timestamptz",
      ),
    );
    assert.equal((await rankRead(null, null, "c".repeat(64))).mine.rank, null);
    await db.exec(
      "update student_sessions set expires_at='2020-01-01' where token_hash=repeat('c',64)",
    );
    await assert.rejects(rankRead(null, null, "c".repeat(64)), /로그인/);
    await db.exec("set role authenticated");
    await assert.rejects(menuApi("read"), /permission/i);
    await assert.rejects(
      db.query("select * from role_menu_order"),
      /permission/i,
    );
    await assert.rejects(rankRead(), /permission/i);
    await assert.rejects(cleaningNotice("read"), /permission/i);
    await assert.rejects(
      db.query("select * from cleaning_notice"),
      /permission/i,
    );
    await assert.rejects(cleaningApi("read"), /permission/i);
    await assert.rejects(
      db.query("select * from cleaning_slots"),
      /permission/i,
    );
    await assert.rejects(
      importRows(admin, [{ number: "39902", name: "권한" }]),
      /permission/i,
    );
    await assert.rejects(
      warn(admin, warningStudent, "위조"),
      /permission denied/,
    );
    await assert.rejects(snap(admin), /permission denied/);
    await assert.rejects(deleteWarning(admin), /permission denied/);
    await assert.rejects(sheetSync(admin, "status"), /permission denied/);
    await assert.rejects(
      db.query("select * from seat_sheet_sync_config"),
      /permission denied/,
    );
    await assert.rejects(supervision("read", {}, admin), /permission denied/);
    await assert.rejects(
      db.query("select * from supervision_slots"),
      /permission denied/,
    );
    await assert.rejects(bulkDelete(admin, [bulkIds[2]]), /permission denied/);
    await assert.rejects(
      teacherWarning("warning_issue", teacherPayload),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select * from teacher_warning_events"),
      /permission denied/,
    );
    await assert.rejects(assign(admin, []), /permission denied/);
    await assert.rejects(
      db.query("select * from warning_cards"),
      /permission denied/,
    );

    await assert.rejects(issue(admin, student), /permission denied/);
    await assert.rejects(remove(admin, student), /permission denied/);
    await assert.rejects(lookup(admin, student), /permission denied/);
    await assert.rejects(setCopy(admin, originalCopy), /permission denied/);
    await assert.rejects(
      deleteVisit(admin, "직접 삭제 시도"),
      /permission denied/,
    );
    await assert.rejects(access(admin), /permission denied/);
    await assert.rejects(
      api("snapshot", {}, "a".repeat(64)),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select * from teacher_viewer_code"),
      /permission denied/,
    );
    await assert.rejects(
      gender(admin, [student], "female"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
