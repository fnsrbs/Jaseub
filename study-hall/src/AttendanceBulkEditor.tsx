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
    [start, setStart] = useState(period),
    [end, setEnd] = useState(period),
    [status, setStatus] = useState<AttendanceStatus>("excused"),
    [note, setNote] = useState(""),
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
  }, [student, start, end, status, note]);
  useEffect(() => {
    if (!student) return;
    const saved = Array.from({ length: end - start + 1 }, (_, i) => {
      const session = result.sessions.find((s) => s.period === start + i);
      const entry = session?.entries.find((e) => e.student_id === student);
      return session?.confirmed || entry?.confirmed ? entry : undefined;
    });
    const first = saved[0];
    if (
      first &&
      saved.every((e) => e?.status === first.status && e.note === first.note)
    ) {
      setStatus(first.status);
      setNote(first.note);
    } else {
      setStatus("excused");
      setNote("");
    }
  }, [student, start, end]);
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
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            const revisions = Object.fromEntries(
              Array.from({ length: end - start + 1 }, (_, i) => [
                start + i,
                result.sessions.find((s) => s.period === start + i)?.revision ??
                  0,
              ]),
            );
            const next = await api(
              "period_attendance_bulk",
              {
                day,
                student_id: student,
                start_period: start,
                end_period: end,
                status,
                note: note.trim(),
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
          <div className="attendance-bulk-periods">
            <label className="field">
              <span>시작 교시</span>
              <select
                aria-label="시작 교시"
                value={start}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setStart(n);
                  if (end < n) setEnd(n);
                }}
              >
                {Array.from({ length: count }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}교시
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>종료 교시</span>
              <select
                aria-label="종료 교시"
                value={end}
                onChange={(e) => setEnd(Number(e.target.value))}
              >
                {Array.from({ length: count - start + 1 }, (_, i) => (
                  <option key={i} value={start + i}>
                    {start + i}교시
                  </option>
                ))}
              </select>
            </label>
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
            {selected.number} · {selected.name} / {start}~{end}교시 /{" "}
            {attendanceLabels[status]}
          </p>
        )}
        <p className="muted">
          전체 교시 확인 전에도 이 학생의 기록만 저장됩니다. 구글 시트는 기존
          마지막 교시 반영 기준을 따릅니다.
        </p>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="actions">
          <button
            className="primary"
            disabled={busy || !student || !note.trim()}
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
