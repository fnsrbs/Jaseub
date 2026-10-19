import { AttendanceExemption, validExemption } from "./AttendanceExemption";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Student } from "./domain";
import {
  attendanceLabels,
  periodsForDay,
  type AttendanceDay,
  type AttendanceStatus,
} from "./period-attendance";
export function AttendanceBulkEditor({
  day,
  period,
  students,
  result,
  role,
  token,
  onSaved,
  close,
}: {
  day: string;
  period: number;
  students: Student[];
  result: AttendanceDay;
  role: "teacher" | "viewer";
  token: string | null;
  onSaved: (next: AttendanceDay) => void;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    requestId = useRef(crypto.randomUUID());
  const [search, setSearch] = useState(""),
    [student, setStudent] = useState(""),
    [periods, setPeriods] = useState<number[]>([period]),
    [status, setStatus] = useState<AttendanceStatus>("excused"),
    [note, setNote] = useState(""),
    [exemption, setExemption] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const count = periodsForDay(day),
    choices = students
      .filter(
        (s) => !s.deleted_at && `${s.number} ${s.name}`.includes(search.trim()),
      )
      .sort((a, b) =>
        a.number.localeCompare(b.number, "ko", { numeric: true }),
      );
  const selected = students.find((s) => s.id === student);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  useEffect(() => {
    requestId.current = crypto.randomUUID();
  }, [student, periods, status, note, exemption]);
  useEffect(() => {
    if (!student) return;
    const saved = periods.map((n) => {
      const session = result.sessions.find((s) => s.period === n);
      const entry = session?.entries.find((e) => e.student_id === student);
      return session?.confirmed || entry?.confirmed ? entry : undefined;
    });
    const first = saved[0];
    if (
      first &&
      saved.every(
        (e) =>
          e?.status === first.status &&
          e.note === first.note &&
          (e.exempt_reason || "") === (first.exempt_reason || ""),
      )
    ) {
      setStatus(first.status);
      setNote(first.note);
      setExemption(first.exempt_reason || "");
    } else {
      setStatus("excused");
      setNote("");
      setExemption("");
    }
  }, [student, periods]);
  return (
    <dialog
      ref={dialog}
      className="attendance-editor attendance-bulk-editor"
      aria-label="학생별 여러 교시 변경"
      onClose={close}
      onCancel={(e) => {
        if (busy) e.preventDefault();
      }}
    >
      <h2>학생별 여러 교시 변경</h2>
      <p>
        {day} · 선택한 학생의 출결과 사유만 바로 저장합니다. 기존 기록도 수정할
        수 있습니다.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !periods.length) return;
          setBusy(true);
          setError("");
          try {
            const revisions = Object.fromEntries(
              periods.map((n) => [
                n,
                result.sessions.find((s) => s.period === n)?.revision ?? 0,
              ]),
            );
            const next = await api(
              "period_attendance_bulk",
              {
                day,
                student_id: student,
                periods,
                status,
                note: note.trim(),
                exempt_reason: status === "excused" ? exemption.trim() : "",
                request_id: requestId.current,
                revisions,
              },
              role,
              token,
            );
            onSaved(next);
            close();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <label className="field">
            <span>이름·학번 검색</span>
            <input
              aria-label="이름·학번 검색"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="학생 찾기"
            />
          </label>
          <label className="field">
            <span>변경할 학생</span>
            <select
              aria-label="변경할 학생"
              required
              value={student}
              onChange={(e) => setStudent(e.target.value)}
            >
              <option value="">학생 선택</option>
              {(selected && !choices.some((s) => s.id === student)
                ? [selected, ...choices]
                : choices
              ).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number} · {s.name}
                </option>
              ))}
            </select>
          </label>
          <div
            className="attendance-bulk-periods"
            role="group"
            aria-label="변경할 교시"
          >
            <span>변경할 교시 · 여러 개 선택</span>
            <div className="attendance-period-options">
              {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
                <label key={n}>
                  <input
                    type="checkbox"
                    checked={periods.includes(n)}
                    onChange={(e) =>
                      setPeriods(
                        e.target.checked
                          ? [...periods, n].sort((a, b) => a - b)
                          : periods.filter((p) => p !== n),
                      )
                    }
                  />
                  {n}교시
                </label>
              ))}
            </div>
            <div className="actions">
              <button
                type="button"
                onClick={() =>
                  setPeriods(Array.from({ length: count }, (_, i) => i + 1))
                }
              >
                전체 선택
              </button>
              <button type="button" onClick={() => setPeriods([])}>
                선택 해제
              </button>
            </div>
          </div>
          <label className="field">
            <span>출결 상태</span>
            <select
              aria-label="출결 상태"
              value={status}
              onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
            >
              {Object.entries(attendanceLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {status === "excused" && (
            <AttendanceExemption value={exemption} onChange={setExemption} />
          )}
          <label className="field">
            <span>사유</span>
            <textarea
              aria-label="사유"
              required
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="예: 병원 진료, 인정결석"
            />
          </label>
        </fieldset>
        {selected && (
          <p className="alert">
            {selected.number} · {selected.name} /{" "}
            {periods.length ? periods.join("·") + "교시" : "교시를 선택하세요"}{" "}
            / {attendanceLabels[status]}
          </p>
        )}
        <p className="muted">
          전체 교시 확인 전에도 이 학생의 기록만 저장됩니다. 구글 시트는 기존
          모든 교시 확인 완료 후 반영됩니다.
        </p>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="actions">
          <button
            className="primary"
            disabled={
              busy ||
              !student ||
              !periods.length ||
              !note.trim() ||
              (status === "excused" && !validExemption(exemption))
            }
          >
            {busy ? "저장 중…" : "선택한 교시 저장"}
          </button>
          <button type="button" disabled={busy} onClick={close}>
            취소
          </button>
        </div>
      </form>
    </dialog>
  );
}
