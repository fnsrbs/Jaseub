import { pollWhileVisible } from "./visible-polling";
import { useEffect, useState } from "react";
import { api } from "./api";
import { koreanDay, type Snapshot } from "./domain";
import { cleaningPlan, type CleaningSlot } from "./cleaning-plan";
export function Cleaning({
  role,
  token,
  data,
  act,
}: {
  role: "teacher" | "viewer" | "student";
  token: string | null;
  data: Snapshot;
  act: (a: string, p: any) => Promise<any>;
}) {
  const admin = role === "teacher";
  const [notice, setNotice] = useState<{
      body: string;
      revision: number;
    } | null>(null),
    [noticeDraft, setNoticeDraft] = useState<string | null>(null);
  const [rows, setRows] = useState<CleaningSlot[]>([]),
    [draft, setDraft] = useState<CleaningSlot[] | null>(null),
    [edit, setEdit] = useState<CleaningSlot | null>(null);
  const [start, setStart] = useState(koreanDay(new Date())),
    [weeks, setWeeks] = useState(4),
    [weekdays, setWeekdays] = useState([3, 5]);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false);
  const load = async () => setRows(await api("cleaning", {}, role, token));
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const [r, n] = await Promise.all([
          api("cleaning", {}, role, token),
          api("cleaning_notice", {}, role, token),
        ]);
        if (alive) {
          setRows(r);
          setNotice(n);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    };
    const stopPolling = pollWhileVisible(refresh, 30000);
    return () => {
      alive = false;
      stopPolling();
    };
  }, [role, token]);
  const save = async (slots: CleaningSlot[]) => {
    setSaving(true);
    setError("");
    try {
      await act("cleaning_save", {
        slots: slots.map((s) => ({
          day: s.day,
          note: s.note,
          revision: s.revision,
          student_ids: s.students.map((s) => s.id),
        })),
      });
      await load();
      setDraft(null);
      setEdit(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const shown = draft || rows;
  const active = data.students
    .filter((s) => s.active && !s.deleted_at)
    .sort((a, b) => a.number.localeCompare(b.number, "ko", { numeric: true }));
  const myId = role === "student" ? data.students[0]?.id : null;
  return (
    <div className="panel">
      <h2>{admin ? "청소 당번표 관리" : "청소 당번 순서표"}</h2>
      {notice && (
        <section className="cleaning-notice" aria-label="청소 안내">
          <h3>청소 안내</h3>
          <p>{notice.body}</p>
          {admin && noticeDraft === null && (
            <button
              disabled={saving}
              onClick={() => setNoticeDraft(notice.body)}
            >
              안내 메시지 수정
            </button>
          )}
          {admin && noticeDraft !== null && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSaving(true);
                setError("");
                void act("cleaning_notice_save", {
                  body: noticeDraft,
                  revision: notice.revision,
                })
                  .then((n) => {
                    setNotice(n);
                    setNoticeDraft(null);
                  })
                  .catch((e) => setError(e.message))
                  .finally(() => setSaving(false));
              }}
            >
              <label className="field">
                <span>청소 안내 메시지</span>
                <textarea
                  required
                  maxLength={3000}
                  rows={4}
                  value={noticeDraft}
                  disabled={saving}
                  onChange={(e) => setNoticeDraft(e.target.value)}
                />
              </label>
              <button className="primary" disabled={saving}>
                안내 저장
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => setNoticeDraft(null)}
              >
                취소
              </button>
            </form>
          )}
        </section>
      )}
      {admin && (
        <details className="cleaning-generator">
          <summary>당번표 만들기 · 전원 1회씩 균등 배정</summary>
          <div className="form-grid">
            <label className="field">
              <span>시작일</span>
              <input
                type="date"
                required
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </label>
            <label className="field">
              <span>운영 기간</span>
              <select value={weeks} onChange={(e) => setWeeks(+e.target.value)}>
                {[1, 2, 3, 4, 5, 6].map((w) => (
                  <option key={w} value={w}>
                    {w}주
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset>
            <legend>청소 요일 · 2개 선택</legend>
            <div className="actions">
              {["일", "월", "화", "수", "목", "금", "토"].map((d, i) => (
                <label key={d}>
                  <input
                    type="checkbox"
                    checked={weekdays.includes(i)}
                    onChange={() =>
                      setWeekdays(
                        weekdays.includes(i)
                          ? weekdays.filter((v) => v !== i)
                          : [...weekdays, i],
                      )
                    }
                  />
                  {d}
                </label>
              ))}
            </div>
          </fieldset>
          <p>
            현재 활동 학생 {active.length}명 · {weeks * 2}회 청소 · 1회당{" "}
            {Math.floor(active.length / (weeks * 2))}~
            {Math.ceil(active.length / (weeks * 2))}명. 학번순으로 나누며 전원이
            1회씩 맡습니다.
          </p>
          <button
            disabled={saving}
            onClick={() => {
              try {
                const plan = cleaningPlan(
                  data.students,
                  start,
                  weeks,
                  weekdays,
                ).map((s) => ({
                  ...s,
                  revision: rows.find((r) => r.day === s.day)?.revision || 0,
                }));
                setDraft(plan);
                setEdit(null);
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            당번표 미리보기
          </button>
        </details>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {draft && (
        <div className="actions">
          <strong>미리보기 · 아직 저장되지 않았습니다.</strong>
          <button
            className="primary"
            disabled={saving}
            onClick={() => {
              if (
                confirm(
                  "이 날짜들의 청소 당번을 저장할까요? 같은 날짜의 기존 당번은 교체됩니다.",
                )
              )
                void save(draft);
            }}
          >
            당번표 저장
          </button>
          <button disabled={saving} onClick={() => setDraft(null)}>
            취소
          </button>
        </div>
      )}
      {admin && !draft && (
        <button
          disabled={saving}
          onClick={() => {
            setEdit({ day: "", note: "", revision: 0, students: [] });
            setError("");
          }}
        >
          청소 날짜 추가
        </button>
      )}
      {loading ? (
        <p>청소 당번표를 불러오는 중입니다.</p>
      ) : !shown.length ? (
        <p>등록된 청소 당번표가 없습니다.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>순서</th>
                <th>청소 날짜</th>
                <th>청소 당번</th>
                <th>안내</th>
                {admin && !draft && <th>관리</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((s, i) => (
                <tr
                  key={s.day}
                  className={
                    myId && s.students.some((st) => st.id === myId)
                      ? "cleaning-mine"
                      : ""
                  }
                >
                  <td>{i + 1}</td>
                  <td>
                    {new Date(`${s.day}T12:00:00+09:00`).toLocaleDateString(
                      "ko-KR",
                      {
                        timeZone: "Asia/Seoul",
                        month: "numeric",
                        day: "numeric",
                        weekday: "short",
                      },
                    )}
                  </td>
                  <td>
                    <div className="cleaning-members">
                      {s.students.length
                        ? s.students.map((st) => (
                            <span
                              key={st.id}
                              className={st.id === myId ? "cleaning-me" : ""}
                            >
                              {st.number} {st.name}
                              {st.id === myId ? " · 나" : ""}
                            </span>
                          ))
                        : "미배정"}
                    </div>
                  </td>
                  <td>{s.note || "—"}</td>
                  {admin && !draft && (
                    <td>
                      <button
                        disabled={saving}
                        onClick={() => {
                          setEdit({ ...s, students: [...s.students] });
                          setError("");
                        }}
                      >
                        수정
                      </button>
                      <button
                        disabled={saving}
                        onClick={() => {
                          if (!confirm(`${s.day} 청소 당번표를 삭제할까요?`))
                            return;
                          setSaving(true);
                          void act("cleaning_delete", {
                            day: s.day,
                            revision: s.revision,
                          })
                            .then(load)
                            .catch((e) => setError(e.message))
                            .finally(() => setSaving(false));
                        }}
                      >
                        삭제
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {admin && edit && (
        <div className="panel" role="dialog" aria-label="청소 당번 수정">
          <h3>청소 당번 수정</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save([edit]);
            }}
          >
            <label className="field">
              <span>청소 날짜</span>
              <input
                required
                type="date"
                value={edit.day}
                disabled={saving || edit.revision > 0}
                onChange={(e) => setEdit({ ...edit, day: e.target.value })}
              />
            </label>
            {edit.revision > 0 && (
              <small>
                날짜를 옮기려면 새 날짜에 추가한 뒤 기존 날짜를 삭제하세요.
              </small>
            )}
            <fieldset>
              <legend>청소 당번 · {edit.students.length}명 선택</legend>
              <div className="cleaning-student-picker">
                {active.map((s) => (
                  <label key={s.id}>
                    <input
                      type="checkbox"
                      disabled={saving}
                      checked={edit.students.some((st) => st.id === s.id)}
                      onChange={() =>
                        setEdit({
                          ...edit,
                          students: edit.students.some((st) => st.id === s.id)
                            ? edit.students.filter((st) => st.id !== s.id)
                            : [
                                ...edit.students,
                                { id: s.id, name: s.name, number: s.number },
                              ],
                        })
                      }
                    />
                    {s.number} {s.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="field">
              <span>청소 안내</span>
              <input
                maxLength={500}
                disabled={saving}
                value={edit.note}
                onChange={(e) => setEdit({ ...edit, note: e.target.value })}
              />
            </label>
            <button className="primary" disabled={saving}>
              저장
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setEdit(null)}
            >
              취소
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
