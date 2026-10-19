import { useEffect, useRef, useState } from "react";
import { AttendanceExemption, validExemption } from "./AttendanceExemption";
import {
  attendanceLabels,
  type AttendanceEntry,
  type AttendanceStatus,
} from "./period-attendance";

export function AttendanceStudentBulk({
  period,
  entries,
  apply,
  close,
}: {
  period: number;
  entries: AttendanceEntry[];
  apply: (
    ids: string[],
    status: AttendanceStatus,
    note: string,
    exemption: string,
  ) => void;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string[]>([]),
    [search, setSearch] = useState("");
  const [status, setStatus] = useState<AttendanceStatus>("present"),
    [note, setNote] = useState(""),
    [exemption, setExemption] = useState("");
  const visible = entries
    .filter((e) =>
      `${e.number} ${e.name} ${e.seat_id || ""}`.includes(search.trim()),
    )
    .sort((a, b) => a.number.localeCompare(b.number, "ko", { numeric: true }));
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="attendance-editor attendance-student-bulk"
      aria-label={`${period}교시 여러 학생 변경`}
      onClose={close}
    >
      <h2>{period}교시 여러 학생 변경</h2>
      <p>
        이 교시에서 선택한 학생만 함께 변경합니다. 적용 후 ‘출석 확인 완료’ 또는
        ‘변경사항 저장’을 눌러 주세요.
      </p>
      <label className="field">
        <span>학생 검색</span>
        <input
          aria-label="함께 변경할 학생 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="학번·이름·좌석번호"
        />
      </label>
      <div className="actions">
        <button
          type="button"
          onClick={() => setSelected(entries.map((e) => e.student_id))}
        >
          학생 전체 선택 ({entries.length}명)
        </button>
        {!!search.trim() && (
          <button
            type="button"
            onClick={() =>
              setSelected([
                ...new Set([...selected, ...visible.map((e) => e.student_id)]),
              ])
            }
          >
            검색 결과 선택
          </button>
        )}
        <button type="button" onClick={() => setSelected([])}>
          선택 해제
        </button>
      </div>
      <p role="status">
        선택 {selected.length}명 / 전체 {entries.length}명
      </p>
      <div
        className="attendance-bulk-students"
        role="group"
        aria-label="함께 변경할 학생"
      >
        {visible.map((e) => (
          <label key={e.student_id}>
            <input
              type="checkbox"
              checked={selected.includes(e.student_id)}
              onChange={(event) =>
                setSelected(
                  event.target.checked
                    ? [...selected, e.student_id]
                    : selected.filter((id) => id !== e.student_id),
                )
              }
            />
            <span>
              <small>
                {e.number} · {e.seat_id ? `${e.seat_id}번` : "좌석 미배정"}
              </small>
              <strong>{e.name}</strong>
            </span>
            <small>{attendanceLabels[e.status]}</small>
          </label>
        ))}
        {!visible.length && <p>검색 결과가 없습니다.</p>}
      </div>
      <label className="field">
        <span>함께 적용할 출결</span>
        <select
          aria-label="함께 적용할 출결"
          value={status}
          onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
        >
          {Object.entries(attendanceLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {status === "excused" && (
        <AttendanceExemption value={exemption} onChange={setExemption} />
      )}
      <label className="field">
        <span>공통 사유·메모 (선택)</span>
        <textarea
          aria-label="공통 사유·메모"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="비워두면 기존 메모를 유지합니다."
        />
      </label>
      <div className="actions">
        <button
          className="primary"
          type="button"
          disabled={
            !selected.length ||
            (status === "excused" && !validExemption(exemption))
          }
          onClick={() =>
            apply(
              selected,
              status,
              note.trim(),
              status === "excused" ? exemption.trim() : "",
            )
          }
        >
          선택 학생 적용
        </button>
        <button type="button" onClick={close}>
          취소
        </button>
      </div>
    </dialog>
  );
}
