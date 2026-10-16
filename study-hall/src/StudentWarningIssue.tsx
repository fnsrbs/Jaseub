import { useRef, useState } from "react";
import type { Student } from "./domain";

export function StudentWarningIssue({
  student,
  busy,
  act,
}: {
  student: Student;
  busy: boolean;
  act: (action: string, payload: any) => Promise<any>;
}) {
  const [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const submitting = useRef(false);
  return (
    <section className="panel" aria-label="선택 학생 경고 발급">
      <h2>경고카드 발급</h2>
      <p>
        <strong>
          {student.number} · {student.name}
        </strong>{" "}
        학생에게 경고카드 1장을 발급합니다.
      </p>
      <form
        className="form-grid"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || submitting.current || !reason.trim()) return;
          submitting.current = true;
          setPending(true);
          setError("");
          setMessage("");
          try {
            await act("warning_issue", {
              student_id: student.id,
              reason: reason.trim(),
              request_id: requestId,
            });
            setReason("");
            setRequestId(crypto.randomUUID());
            setMessage(`${student.name} 학생에게 경고카드 1장을 발급했습니다.`);
          } catch (error) {
            setError((error as Error).message);
          } finally {
            submitting.current = false;
            setPending(false);
          }
        }}
      >
        <label className="field">
          <span>경고 사유</span>
          <input
            required
            maxLength={1000}
            disabled={busy || pending}
            value={reason}
            placeholder="예: 자습 중 소란"
            onChange={(event) => {
              setReason(event.target.value);
              setRequestId(crypto.randomUUID());
              setMessage("");
            }}
          />
        </label>
        <button
          className="warning-button"
          disabled={busy || pending || !reason.trim()}
        >
          {pending ? "발급 중…" : "경고카드 1장 발급"}
        </button>
      </form>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
