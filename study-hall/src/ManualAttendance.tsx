import { useRef, useState } from "react";
import type { Snapshot } from "./domain";

export function ManualAttendance({
  data,
  act,
  busy,
}: {
  data: Snapshot;
  act: (action: string, payload: any) => Promise<any>;
  busy: boolean;
}) {
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState(""),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const request = useRef({ key: "", id: "" });
  const students = data.students
    .filter(
      (s) =>
        !s.deleted_at &&
        `${s.number} ${s.name} ${s.seat_id || ""}`.includes(search.trim()),
    )
    .sort((a, b) => a.number.localeCompare(b.number, "ko", { numeric: true }));
  const student = data.students.find((s) => s.id === selected && !s.deleted_at);
  const visit =
    student &&
    data.visits.find((v) => v.student_id === student.id && !v.exited_at);
  async function submit(direction: "in" | "out") {
    if (!student || busy) return;
    const clean = reason.trim();
    if (!clean) {
      setError("수동 처리 사유를 입력하세요.");
      return;
    }
    const key = JSON.stringify([student.id, direction, clean]);
    if (request.current.key !== key)
      request.current = { key, id: crypto.randomUUID() };
    setError("");
    setMessage("");
    try {
      await act("manual", {
        student_id: student.id,
        direction,
        reason: clean,
        request_id: request.current.id,
      });
      setMessage(
        `${student.number} ${student.name} 학생을 ${direction === "in" ? "입실" : "퇴실"} 처리했습니다.`,
      );
      setReason("");
      request.current = { key: "", id: "" };
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <details className="panel manual-attendance">
      <summary>수동 입실·퇴실</summary>
      <p>
        QR을 찍지 못한 학생을 대신 입실·퇴실 처리합니다. 처리 시각과 사유가
        기록됩니다.
      </p>
      <label className="field">
        <span>이름·학번·좌석번호 검색</span>
        <input
          type="search"
          value={search}
          disabled={busy}
          placeholder="학생 검색"
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <div className="manual-student-list" aria-label="수동 처리 학생 선택">
        {students.map((s) => (
          <button
            type="button"
            key={s.id}
            disabled={busy}
            aria-pressed={selected === s.id}
            onClick={() => {
              setSelected(s.id);
              setReason("");
              setError("");
              setMessage("");
            }}
          >
            <small>
              {s.number} · {s.seat_id ? `${s.seat_id}번` : "미배정"}
            </small>
            <strong>{s.name}</strong>
            <span>
              {data.visits.some((v) => v.student_id === s.id && !v.exited_at)
                ? "입실 중"
                : "퇴실"}
              {!s.active ? " · 이용 제한" : ""}
            </span>
          </button>
        ))}
      </div>
      {!students.length && <p>검색 결과가 없습니다.</p>}
      {student && (
        <form
          className="manual-attendance-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(visit ? "out" : "in");
          }}
        >
          <h3>
            {student.number} {student.name}
          </h3>
          <p>
            현재{" "}
            {visit
              ? `입실 중 · ${new Date(visit.entered_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 입실`
              : "퇴실 상태"}
          </p>
          <label className="field">
            <span>수동 처리 사유</span>
            <input
              required
              maxLength={500}
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
              placeholder="예: 카메라 오류로 QR을 찍지 못함"
            />
          </label>
          <button
            className="primary"
            disabled={busy || (!visit && !student.active)}
          >
            {busy ? "처리 중…" : visit ? "수동 퇴실" : "수동 입실"}
          </button>
          {!visit && !student.active && (
            <p>이용 제한 학생은 입실 처리할 수 없습니다.</p>
          )}
        </form>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </details>
  );
}
