import { pollWhileVisible } from "./visible-polling";
import { useEffect, useState } from "react";
import { api } from "./api";
import { koreanDay, type SupervisionSlot } from "./domain";
type Role = "teacher" | "viewer";
export function Supervision({
  role,
  token,
  act,
}: {
  role: Role;
  token: string | null;
  act: (a: string, p: any) => Promise<any>;
}) {
  const [slots, setSlots] = useState<SupervisionSlot[]>([]);
  const [week, setWeek] = useState("");
  const [edit, setEdit] = useState<SupervisionSlot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const admin = role === "teacher";
  const load = async () => {
    const rows: SupervisionSlot[] = await api("supervision", {}, role, token);
    rows.sort((a, b) => a.day.localeCompare(b.day) || a.period - b.period);
    setSlots(rows);
    setWeek((current) =>
      rows.some((s) => s.week_label === current)
        ? current
        : (rows.find((s) => s.day >= koreanDay(new Date())) || rows[0])
            ?.week_label || "",
    );
  };
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        if (alive) {
          await load();
          setError("");
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
  const weeks = [...new Set(slots.map((s) => s.week_label))];
  const shown = slots.filter((s) => s.week_label === week);
  const days = [...new Set(shown.map((s) => s.day))].sort();
  const label = (s: SupervisionSlot) =>
    s.status === "assigned"
      ? s.teacher_name
      : s.status === "closed"
        ? "운영 없음"
        : s.status === "event"
          ? s.note || "행사"
          : "미배정";
  return (
    <div className="panel">
      <div className="section-head supervision-head">
        <h2>{admin ? "감독표 관리" : "감독 조회"}</h2>
        <label className="field">
          <span>주차</span>
          <select
            aria-label="감독표 주차"
            value={week}
            disabled={saving}
            onChange={(e) => {
              setWeek(e.target.value);
              setEdit(null);
            }}
          >
            {weeks.map((w) => (
              <option key={w}>{w}</option>
            ))}
          </select>
        </label>
      </div>
      {admin && (
        <div className="actions">
          <button
            type="button"
            disabled={saving || loading || !!edit}
            onClick={() => {
              setSaving(true);
              setError("");
              setMessage("");
              void act("supervision_import", {})
                .then(async (result) => {
                  await load();
                  setMessage(
                    result.saved
                      ? `구글 감독표를 불러왔습니다. ${result.saved}개 항목을 반영했습니다. 변경된 항목은 ‘수정’으로 표시합니다.`
                      : "불러오기 완료 · 기존 감독표와 동일합니다.",
                  );
                })
                .catch((e) =>
                  setError(
                    (e as Error).message === "지원하지 않는 요청"
                      ? "구글 연결 코드 업데이트가 필요합니다. 좌석 관리 → 구글 시트 연결 설정에서 새 코드를 준비해 Apps Script에 붙여 넣고, 배포 관리에서 새 버전으로 업데이트하세요."
                      : (e as Error).message,
                  ),
                )
                .finally(() => setSaving(false));
            }}
          >
            {saving ? "처리 중…" : "구글에서 불러오기"}
          </button>
          <span>
            구글 감독표를 수정한 뒤 불러오세요. 감독 횟수도 다시 계산됩니다.
          </span>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {admin && <p>수정할 날짜·교시를 누르세요.</p>}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {loading ? (
        <p>감독표를 불러오는 중입니다.</p>
      ) : !slots.length ? (
        <p>등록된 감독표가 없습니다.</p>
      ) : (
        <div className="table-wrap">
          <table className="supervision-table">
            <thead>
              <tr>
                <th>교시</th>
                {days.map((day) => (
                  <th key={day}>
                    {new Date(`${day}T12:00:00+09:00`).toLocaleDateString(
                      "ko-KR",
                      {
                        timeZone: "Asia/Seoul",
                        month: "numeric",
                        day: "numeric",
                        weekday: "short",
                      },
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5, 6, 7].map((period) => (
                <tr key={period}>
                  <th>{period}교시</th>
                  {days.map((day) => {
                    const slot = shown.find(
                      (s) => s.day === day && s.period === period,
                    );
                    return (
                      <td
                        key={day}
                        className={
                          slot?.status !== "assigned" ? "supervision-muted" : ""
                        }
                      >
                        {slot && (
                          <>
                            {admin ? (
                              <button
                                type="button"
                                aria-label={`${day} ${period}교시 감독 수정`}
                                disabled={saving}
                                onClick={() => {
                                  setEdit({ ...slot });
                                  setError("");
                                }}
                              >
                                {label(slot)}
                              </button>
                            ) : (
                              <span>{label(slot)}</span>
                            )}
                            {slot.revision > 1 && (
                              <small className="supervision-changed">
                                수정
                              </small>
                            )}
                            {slot.status !== "event" && slot.note && (
                              <small>{slot.note}</small>
                            )}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!slots.length && (
        <div className="table-wrap">
          <h3>교사별 감독 횟수</h3>
          <table>
            <thead>
              <tr>
                <th>교사</th>
                <th>선택 주차</th>
                <th>전체</th>
              </tr>
            </thead>
            <tbody>
              {[
                ...new Set(
                  slots
                    .filter((s) => s.status === "assigned")
                    .map((s) => s.teacher_name),
                ),
              ]
                .sort((a, b) => a.localeCompare(b, "ko"))
                .map((name) => (
                  <tr key={name}>
                    <th>{name}</th>
                    <td>
                      {
                        shown.filter(
                          (s) =>
                            s.status === "assigned" && s.teacher_name === name,
                        ).length
                      }
                    </td>
                    <td>
                      {
                        slots.filter(
                          (s) =>
                            s.status === "assigned" && s.teacher_name === name,
                        ).length
                      }
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {admin && edit && (
        <div
          className="panel seat-edit-controls"
          role="dialog"
          aria-label="감독표 수정"
        >
          <h3>
            {edit.day} · {edit.period}교시
          </h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSaving(true);
              setError("");
              void act("supervision_save", { slots: [edit] })
                .then(async () => {
                  setEdit(null);
                  await load();
                })
                .catch((e) => setError((e as Error).message))
                .finally(() => setSaving(false));
            }}
          >
            <label className="field">
              <span>상태</span>
              <select
                value={edit.status}
                disabled={saving}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    status: e.target.value as SupervisionSlot["status"],
                    teacher_name:
                      e.target.value === "assigned" ? edit.teacher_name : "",
                  })
                }
              >
                <option value="assigned">감독 배정</option>
                <option value="closed">운영 없음</option>
                <option value="event">행사</option>
                <option value="unassigned">미배정</option>
              </select>
            </label>
            {edit.status === "assigned" && (
              <label className="field">
                <span>감독 교사</span>
                <input
                  required
                  maxLength={80}
                  value={edit.teacher_name}
                  disabled={saving}
                  onChange={(e) =>
                    setEdit({ ...edit, teacher_name: e.target.value })
                  }
                  list="supervision-teachers"
                />
                <datalist id="supervision-teachers">
                  {[
                    ...new Set(
                      slots
                        .filter((s) => s.teacher_name)
                        .map((s) => s.teacher_name),
                    ),
                  ]
                    .sort()
                    .map((name) => (
                      <option key={name} value={name} />
                    ))}
                </datalist>
              </label>
            )}
            <label className="field">
              <span>{edit.status === "event" ? "행사명" : "메모"}</span>
              <input
                maxLength={500}
                required={edit.status === "event"}
                disabled={saving}
                value={edit.note}
                onChange={(e) => setEdit({ ...edit, note: e.target.value })}
              />
            </label>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <button className="primary" disabled={saving}>
              저장
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setEdit(null);
                setError("");
              }}
            >
              취소
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
