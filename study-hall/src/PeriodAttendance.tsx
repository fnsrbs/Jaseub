import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { koreanDay, type Snapshot } from "./domain";
import {
  attendanceLabels,
  defaultAttendance,
  periodAt,
  periodsForDay,
  periodTimes,
  type AttendanceDay,
  type AttendanceEntry,
  type AttendanceStatus,
} from "./period-attendance";

export function PeriodAttendance({
  data,
  role,
  token,
  now,
}: {
  data: Snapshot;
  role: "teacher" | "viewer";
  token: string | null;
  now: number;
}) {
  const today = koreanDay(new Date(now));
  const clock = periodAt(now);
  const [day, setDay] = useState(today);
  const [period, setPeriod] = useState(clock.period);
  const [automatic, setAutomatic] = useState(true);
  const [result, setResult] = useState<AttendanceDay | null>(null);
  const [entries, setEntries] = useState<AttendanceEntry[]>([]);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"seats" | "list">("seats");
  const requestId = useRef(crypto.randomUUID());
  const dirtyRef = useRef(false);
  const dayRef = useRef(day);
  dirtyRef.current = dirty;
  dayRef.current = day;
  const admin = role === "teacher";
  const editable = admin || day === today;
  const session =
    result?.day === day
      ? result.sessions.find((s) => s.period === period)
      : undefined;
  const count = periodsForDay(day);
  const call = (action: string, payload: any = {}) =>
    api(action, { day, ...payload }, role, token);
  const refresh = async () => {
    const next = await call("period_attendance");
    if (next.day === dayRef.current) setResult(next);
    return next;
  };
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setResult(null);
    setError("");
    setMessage("");
    void call("period_attendance")
      .then((next) => {
        if (alive) setResult(next);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [day, role, token]);
  useEffect(() => {
    if (!result || result.day !== day || dirty) return;
    setEntries(
      session?.confirmed
        ? structuredClone(session.entries)
        : session
          ? session.entries.map((e) => ({ ...e, status: "present", note: "" }))
          : defaultAttendance(data.students),
    );
    requestId.current = crypto.randomUUID();
  }, [result, day, period, data.students, dirty]);
  useEffect(() => {
    if (automatic && !dirty && !working && !selected) {
      if (day !== today) setDay(today);
      setPeriod(clock.period);
    }
  }, [automatic, dirty, working, selected, today, clock.period]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const resume = () => {
      if (document.visibilityState === "visible" && !dirtyRef.current)
        void refresh().catch((e) => setError(e.message));
    };
    const leave = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href^="#"]');
      if (
        dirtyRef.current &&
        link &&
        link.getAttribute("href") !== "#attendance" &&
        !confirm("저장하지 않은 출석 변경사항이 있습니다. 버리고 이동할까요?")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", guard);
    document.addEventListener("visibilitychange", resume);
    document.addEventListener("click", leave, true);
    return () => {
      window.removeEventListener("beforeunload", guard);
      document.removeEventListener("visibilitychange", resume);
      document.removeEventListener("click", leave, true);
    };
  }, [day, role, token]);
  const change = (nextDay: string, nextPeriod: number, auto: boolean) => {
    if (
      dirty &&
      !confirm("저장하지 않은 변경사항이 있습니다. 버리고 이동할까요?")
    )
      return;
    setDirty(false);
    setSelected(null);
    setMessage("");
    setError("");
    setDay(nextDay);
    setPeriod(nextPeriod);
    setAutomatic(auto);
  };
  const save = async () => {
    if (working || loading || !editable || !count || !entries.length) return;
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const next: AttendanceDay = await call("period_attendance_save", {
        period,
        revision: session?.revision || 0,
        request_id: requestId.current,
        entries: entries.map((e) => ({
          student_id: e.student_id,
          status: e.status,
          note: e.note,
        })),
      });
      setDirty(false);
      setResult(next);
      requestId.current = crypto.randomUUID();
      setMessage(
        `${period}교시 출석을 저장했습니다.${next.sheet_deferred ? " 구글 시트는 마지막 교시 확인 완료 시 반영됩니다." : next.sheet_sync?.ok ? " 구글 시트 반영 완료." : " 구글 시트 반영 대기."}`,
      );
      if (next.sheet_sync && !next.sheet_sync.ok)
        setError(`DB 저장 완료 · 시트 반영 대기: ${next.sheet_sync.error}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const sync = async () => {
    setWorking(true);
    setError("");
    setMessage("");
    try {
      const next = await call("period_attendance_sync");
      setResult(next);
      if (!next.sheet_sync?.ok)
        throw Error(next.sheet_sync?.error || "시트 반영 실패");
      setMessage("구글 시트에 반영했습니다.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const reset = async () => {
    const reason = prompt(`${day} ${period}교시 출석 초기화 사유`);
    if (
      !reason?.trim() ||
      !confirm("이 교시의 확인 완료를 취소할까요? 변경 이력은 보관됩니다.")
    )
      return;
    setWorking(true);
    setError("");
    try {
      const next = await call("period_attendance_reset", {
        period,
        revision: session?.revision || 0,
        request_id: crypto.randomUUID(),
        reason,
      });
      setDirty(false);
      setResult(next);
      setMessage("확인 전 상태로 초기화했습니다.");
      if (next.sheet_sync && !next.sheet_sync.ok)
        setError(`시트 반영 대기: ${next.sheet_sync.error}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const visible = entries.filter((e) =>
    `${e.number} ${e.name} ${e.seat_id || ""}`.includes(search.trim()),
  );
  const seatButton = (
    entry: AttendanceEntry | undefined,
    seatId?: number,
    col?: number,
  ) => (
    <button
      type="button"
      key={entry?.student_id || `seat-${seatId}`}
      style={col ? { gridColumn: col } : undefined}
      className={`attendance-seat status-${entry?.status || "empty"}`}
      disabled={!entry || !editable || working || loading}
      onClick={() => setSelected(entry!.student_id)}
      aria-label={
        entry
          ? `${entry.seat_id || "미배정"}번 ${entry.number} ${entry.name} ${attendanceLabels[entry.status]}`
          : `${seatId}번 빈자리`
      }
    >
      <span className="attendance-seat-number">
        {seatId
          ? `${seatId}번`
          : entry?.seat_id
            ? `${entry.seat_id}번`
            : "미배정"}
      </span>
      {entry ? (
        <>
          <small>{entry.number}</small>
          <strong>{entry.name}</strong>
          <span className="attendance-state">
            {attendanceLabels[entry.status]}
          </span>
          {entry.note && (
            <span className="attendance-note-dot" title={entry.note}>
              메모
            </span>
          )}
        </>
      ) : (
        <small>빈자리</small>
      )}
    </button>
  );
  return (
    <section className="period-attendance" aria-label="교시별 출석관리">
      <div className="panel">
        <div className="attendance-heading">
          <div>
            <h2>출석관리</h2>
            <p>기본 출석 · 지각·결석 학생만 체크한 뒤 확인 완료해 주세요.</p>
          </div>
          <span
            className={`attendance-confirmed ${session?.confirmed ? "done" : ""}`}
          >
            {session?.confirmed ? "확인 완료" : "확인 전 · 기본 출석"}
            {dirty ? " · 변경 중" : ""}
          </span>
        </div>
        <div className="attendance-toolbar">
          <label className="field">
            <span>날짜</span>
            <input
              type="date"
              value={day}
              disabled={working}
              onChange={(e) => {
                if (e.target.value)
                  change(
                    e.target.value,
                    Math.min(period, periodsForDay(e.target.value) || 1),
                    false,
                  );
              }}
            />
          </label>
          <label className="field">
            <span>교시</span>
            <select
              aria-label="출석 교시"
              value={period}
              disabled={working || !count}
              onChange={(e) => change(day, Number(e.target.value), false)}
            >
              {periodTimes.slice(0, count).map(([start, end], i) => (
                <option value={i + 1} key={start}>
                  {i + 1}교시 · {start}~{end}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={working}
            className={automatic ? "primary" : ""}
            onClick={() => change(today, clock.period, true)}
          >
            현재 교시 자동
          </button>
          <button
            type="button"
            disabled={working || loading}
            onClick={() => {
              if (dirty && !confirm("변경사항을 버리고 다시 조회할까요?"))
                return;
              setDirty(false);
              setLoading(true);
              void refresh()
                .catch((e) => setError(e.message))
                .finally(() => setLoading(false));
            }}
          >
            다시 조회
          </button>
        </div>
        <p className="muted">
          월·화 7교시 / 수·목·금 6교시 ·{" "}
          {day === today
            ? `${clock.label} · 현재 ${clock.period}교시`
            : "선택한 날짜의 출석"}
          {!editable ? " · 과거·미래 기록 수정은 관리자만 가능" : ""}
        </p>
        {automatic && dirty && period !== clock.period && day === today && (
          <p role="status" className="alert">
            다음 교시가 시작됐습니다. 현재 변경사항을 저장한 뒤 교시를 이동해
            주세요.
          </p>
        )}
        {message && (
          <p role="status" className="alert success">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
        {!count ? (
          <p className="empty">토·일요일은 출석 확인 대상 교시가 없습니다.</p>
        ) : loading ? (
          <p role="status">출석을 불러오는 중입니다…</p>
        ) : !result ? (
          <p>출석을 불러오지 못했습니다. 다시 조회해 주세요.</p>
        ) : (
          <>
            <div className="attendance-counts">
              {(Object.keys(attendanceLabels) as AttendanceStatus[]).map(
                (status) => (
                  <span className={`status-${status}`} key={status}>
                    {attendanceLabels[status]}{" "}
                    <strong>
                      {entries.filter((e) => e.status === status).length}명
                    </strong>
                  </span>
                ),
              )}
            </div>
            <div className="attendance-toolbar">
              <div
                className="attendance-view"
                role="group"
                aria-label="출석 보기 방식"
              >
                <button
                  type="button"
                  aria-pressed={view === "seats"}
                  onClick={() => setView("seats")}
                >
                  좌석
                </button>
                <button
                  type="button"
                  aria-pressed={view === "list"}
                  onClick={() => setView("list")}
                >
                  명단
                </button>
              </div>
              <label className="field">
                <span>학생 검색</span>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="학번·이름·좌석번호"
                />
              </label>
            </div>
            <p className="muted">
              {session
                ? "이 교시를 처음 저장했을 때의 학생·좌석 기준입니다."
                : "아직 저장하지 않은 교시는 현재 이용 가능한 학생 기준입니다."}
            </p>
            {view === "list" || search.trim() ? (
              <div className="attendance-student-list">
                {visible.map((e) => seatButton(e, e.seat_id || undefined))}
                {!visible.length && <p>검색 결과가 없습니다.</p>}
              </div>
            ) : (
              <>
                <div className="attendance-seat-map">
                  {[...new Set(data.seats.map((s) => s.row))]
                    .sort((a, b) => a - b)
                    .map((row) => (
                      <div
                        className={`attendance-seat-row ${row === 5 ? "cross-aisle" : ""}`}
                        key={row}
                      >
                        {data.seats
                          .filter((s) => s.row === row)
                          .sort((a, b) => a.col - b.col)
                          .map((seat) =>
                            seatButton(
                              entries.find((e) => e.seat_id === seat.id),
                              seat.id,
                              seat.col,
                            ),
                          )}
                      </div>
                    ))}
                  <div className="room-front">
                    <span>출입문</span>
                    <span>칠판 · 교탁</span>
                    <span>운동장</span>
                  </div>
                </div>
                {entries.some(
                  (e) =>
                    e.seat_id === null ||
                    !data.seats.some((s) => s.id === e.seat_id),
                ) && (
                  <>
                    <h3>좌석 미배정 학생</h3>
                    <div className="attendance-student-list">
                      {entries
                        .filter(
                          (e) =>
                            e.seat_id === null ||
                            !data.seats.some((s) => s.id === e.seat_id),
                        )
                        .map((e) => seatButton(e))}
                    </div>
                  </>
                )}
              </>
            )}
            <div className="attendance-savebar">
              <div>
                <strong>
                  {dirty
                    ? "저장하지 않은 변경사항이 있습니다."
                    : session?.confirmed
                      ? `${period}교시 확인 완료`
                      : `${period}교시 확인 전`}
                </strong>
                <small>
                  {session?.confirmed
                    ? `저장: ${new Date(session.updated_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`
                    : "확인 완료 전에는 DB·구글 시트에 출석으로 기록되지 않습니다."}
                </small>
              </div>
              <button
                type="button"
                className="primary"
                disabled={
                  !editable ||
                  working ||
                  !entries.length ||
                  (!dirty && !!session?.confirmed)
                }
                onClick={() => void save()}
              >
                {working
                  ? "처리 중…"
                  : session?.confirmed
                    ? "변경사항 저장"
                    : "출석 확인 완료"}
              </button>
            </div>
            <div className="actions">
              <span className="muted">
                구글 시트 (월·화 7교시 / 수·목·금 6교시 확인 완료 시 일괄 반영):{" "}
                {result.sessions.length &&
                result.sessions.every((s) => s.synced_revision === s.revision)
                  ? "반영 완료"
                  : result.sessions.length
                    ? "반영 대기"
                    : "저장 후 반영"}
              </span>
              {admin && (
                <>
                  <button
                    type="button"
                    disabled={working}
                    onClick={() => {
                      setWorking(true);
                      setError("");
                      void call("period_attendance_connection")
                        .then(() => setMessage("구글 시트 연결이 정상입니다."))
                        .catch((e) => setError(e.message))
                        .finally(() => setWorking(false));
                    }}
                  >
                    구글 연결 확인
                  </button>
                  <button
                    type="button"
                    disabled={
                      !editable || dirty || working || !result.sessions.length
                    }
                    onClick={() => void sync()}
                  >
                    구글 시트 다시 반영
                  </button>
                </>
              )}
              {admin && session?.confirmed && (
                <button
                  type="button"
                  disabled={working || dirty}
                  onClick={() => void reset()}
                >
                  이 교시 초기화
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {admin && (
        <details className="panel attendance-history">
          <summary>
            변경 이력 · {result?.history.length || 0}건 (최근 100건)
          </summary>
          {result?.history.map((event) => (
            <div key={event.id}>
              <strong>
                {event.period}교시 · {event.reason}
              </strong>
              <small>
                {new Date(event.created_at).toLocaleString("ko-KR", {
                  timeZone: "Asia/Seoul",
                })}{" "}
                · {event.actor.startsWith("admin:") ? "관리자" : "교사"}
              </small>
              {Array.isArray(event.changes) ? (
                event.changes.map((e, i) => (
                  <p key={i}>
                    {e.number} {e.name}:{" "}
                    {e.before ? attendanceLabels[e.before] : "확인 전"} →{" "}
                    {e.after ? attendanceLabels[e.after] : ""}
                    {e.note ? ` · ${e.note}` : ""}
                  </p>
                ))
              ) : (
                <p>이전 기록과 수정 이력은 보관됩니다.</p>
              )}
            </div>
          ))}
        </details>
      )}
      {admin && (
        <details className="panel">
          <summary>구글 시트 연결 안내</summary>
          <p>
            기존 좌석표와 같은 파일의 ‘교시별출석_연도-월’ 탭에 반영합니다.
            연결코드 업데이트가 필요하다는 오류가 나오면 아래 코드를 받아 기존
            Apps Script 코드를 교체하고 새 버전으로 배포해 주세요. 기존 배포
            주소는 유지합니다.
          </p>
          <button
            type="button"
            disabled={working}
            onClick={() => {
              setWorking(true);
              void api("sheet_sync_setup", {}, role, token)
                .then((r) => {
                  const url = URL.createObjectURL(
                    new Blob([r.script], { type: "text/plain;charset=utf-8" }),
                  );
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = "Jaseub-seat-and-attendance-sync.gs";
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                })
                .catch((e) => setError(e.message))
                .finally(() => setWorking(false));
            }}
          >
            업데이트용 연결코드 받기
          </button>
        </details>
      )}
      {selected && entries.find((e) => e.student_id === selected) && (
        <AttendanceEditor
          entry={entries.find((e) => e.student_id === selected)!}
          close={() => setSelected(null)}
          apply={(status, note) => {
            setEntries((current) =>
              current.map((e) =>
                e.student_id === selected ? { ...e, status, note } : e,
              ),
            );
            setDirty(true);
            requestId.current = crypto.randomUUID();
            setSelected(null);
            setMessage("");
          }}
        />
      )}
    </section>
  );
}
function AttendanceEditor({
  entry,
  apply,
  close,
}: {
  entry: AttendanceEntry;
  apply: (status: AttendanceStatus, note: string) => void;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState(entry.status);
  const [note, setNote] = useState(entry.note);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="attendance-editor"
      aria-labelledby="attendance-editor-title"
      onClose={close}
    >
      <h2 id="attendance-editor-title">
        {entry.number} · {entry.name}
      </h2>
      <p>출석 상태를 선택하세요.</p>
      <div className="attendance-status-options">
        {(Object.keys(attendanceLabels) as AttendanceStatus[]).map((value) => (
          <button
            type="button"
            key={value}
            className={`status-${value}`}
            aria-pressed={status === value}
            onClick={() => setStatus(value)}
          >
            {attendanceLabels[value]}
          </button>
        ))}
      </div>
      <label className="field">
        <span>사유·메모 (선택)</span>
        <textarea
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          placeholder="예: 10분 늦게 도착"
        />
      </label>
      <div className="actions">
        <button
          className="primary"
          type="button"
          onClick={() => apply(status, note.trim())}
        >
          적용
        </button>
        <button type="button" onClick={() => dialog.current?.close()}>
          취소
        </button>
      </div>
    </dialog>
  );
}
