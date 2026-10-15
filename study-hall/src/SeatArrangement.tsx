import { useState } from "react";
import { GenderLegend } from "./GenderLegend";
import { editSeat, type Assignment } from "./seat-edit";
import type { Snapshot } from "./domain";
export function SeatArrangement({
  data,
  draft,
  fixed,
  onChange,
}: {
  data: Snapshot;
  draft: Assignment[];
  fixed: string[];
  onChange: (pairs: Assignment[]) => void;
}) {
  const [target, setTarget] = useState<number | null>(null);
  const [student, setStudent] = useState("");
  const [error, setError] = useState("");
  const students = data.students.map((s) => {
    const p = draft.find((p) => p.student_id === s.id);
    return p ? { ...s, seat_id: p.seat_id } : s;
  });
  const rows = [...new Set(data.seats.map((s) => s.row))].sort((a, b) => a - b);
  const occupant = students.find((s) => s.seat_id === target);
  return (
    <>
      <p>
        좌석을 클릭해 학생 또는 빈자리를 선택하세요. 이미 자리가 있는 학생을
        고르면 두 학생의 자리를 맞바꿉니다. 확정 전에는 저장되지 않습니다.
      </p>
      <GenderLegend />
      {target !== null && (
        <div
          className="panel seat-edit-controls"
          role="dialog"
          aria-label={`${target}번 좌석 배정 편집`}
        >
          <h3>
            {target}번 좌석 · 현재 {occupant?.name || "빈자리"}
          </h3>
          <label className="field">
            <span>배정할 학생 / 빈자리</span>
            <select
              value={student}
              onChange={(e) => setStudent(e.target.value)}
            >
              <option value="">빈자리로 변경</option>
              {students
                .filter((s) => s.active && !s.deleted_at)
                .sort(
                  (a, b) =>
                    a.number.localeCompare(b.number, "ko", { numeric: true }) ||
                    a.name.localeCompare(b.name, "ko"),
                )
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.number} ·{" "}
                    {s.seat_id ? `${s.seat_id}번 자리` : "미배정"}
                    {fixed.includes(s.id) ? " · 고정" : ""}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              try {
                onChange(
                  editSeat(
                    data.students,
                    data.seats,
                    draft,
                    target,
                    student || null,
                    fixed,
                  ),
                );
                setError("");
                setTarget(null);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            미리보기에 적용
          </button>
          <button
            type="button"
            onClick={() => {
              setTarget(null);
              setError("");
            }}
          >
            닫기
          </button>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
        </div>
      )}
      <div className="seat-scroll">
        <div className="seat-room">
          <div className="room-caption">
            좌석 배정 편집 · {draft.length ? "미확정 미리보기" : "현재 배정"}
          </div>
          {rows.map((row) => (
            <div
              key={row}
              className={`seat-row ${row === 5 ? "cross-aisle" : ""}`}
            >
              {data.seats
                .filter((s) => s.row === row)
                .sort((a, b) => a.col - b.col)
                .map((seat) => {
                  const st = students.find((s) => s.seat_id === seat.id);
                  return (
                    <button
                      type="button"
                      key={seat.id}
                      style={{ gridColumn: seat.col }}
                      className={`seat ${st?.gender === "male" ? "gender-male" : st?.gender === "female" ? "gender-female" : ""} ${target === seat.id ? "mine" : ""} ${!seat.enabled ? "disabled" : ""}`}
                      disabled={!seat.enabled}
                      aria-label={`${seat.id}번 좌석 편집 ${st?.name || "빈자리"}`}
                      onClick={() => {
                        setTarget(seat.id);
                        setStudent(st?.id || "");
                        setError("");
                      }}
                    >
                      <b>{String(seat.id).padStart(2, "0")}</b>
                      <small>{st?.name || "빈자리"}</small>
                      <small>
                        {st
                          ? st.gender === "male"
                            ? "남학생"
                            : st.gender === "female"
                              ? "여학생"
                              : "성별 미확인"
                          : "학생 배정 가능"}
                      </small>
                      <small>
                        {st && fixed.includes(st.id) ? "고정" : "클릭하여 변경"}
                      </small>
                    </button>
                  );
                })}
            </div>
          ))}
          <div className="room-front">
            <span>출입문</span>
            <span>칠판 · 교탁</span>
            <span>운동장</span>
          </div>
        </div>
      </div>
    </>
  );
}
