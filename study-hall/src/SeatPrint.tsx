import { useState } from "react";
import { createPortal } from "react-dom";
import type { Snapshot } from "./domain";

export function SeatPrint({ data }: { data: Snapshot }) {
  const [pages, setPages] = useState(1);
  const rows = [...new Set(data.seats.map((seat) => seat.row))].sort(
    (a, b) => a - b,
  );
  const split = Math.ceil(rows.length / pages);
  const groups = Array.from({ length: pages }, (_, i) =>
    rows.slice(i * split, (i + 1) * split),
  ).filter((group) => group.length);
  return (
    <>
      <div className="seat-print-controls">
        <label className="field">
          <span>자리배치표 인쇄</span>
          <select
            aria-label="자리배치표 인쇄 매수"
            value={pages}
            onChange={(event) => setPages(Number(event.target.value))}
          >
            <option value={1}>A4 한 장</option>
            <option value={2}>A4 두 장 · 크게 보기</option>
          </select>
        </label>
        <button type="button" onClick={() => window.print()}>
          자리배치표 인쇄
        </button>
        <p className="muted">
          저장된 현재 배정을 인쇄합니다. 변경 중인 미리보기는 배정 저장 후
          인쇄해 주세요.
        </p>
      </div>
      {createPortal(
        <div className={`seat-print seat-print-${pages}`}>
          {groups.map((group, index) => (
            <section className="seat-print-page" key={index}>
              <h1>용인고 온실 · 자리배치표</h1>
              <p>
                현재 저장된 배정 · {index + 1} / {groups.length}쪽 ·{" "}
                {new Date().toLocaleDateString("ko-KR", {
                  timeZone: "Asia/Seoul",
                })}
              </p>
              <div className="seat-print-direction">뒤쪽 ↑ · 앞쪽 / 칠판 ↓</div>
              {group.map((row) => (
                <div className="seat-print-row" key={row}>
                  {data.seats
                    .filter((seat) => seat.row === row)
                    .sort((a, b) => a.col - b.col)
                    .map((seat) => {
                      const student = data.students.find(
                        (s) => !s.deleted_at && s.seat_id === seat.id,
                      );
                      return (
                        <div
                          className="seat-print-cell"
                          style={{ gridColumn: seat.col }}
                          key={seat.id}
                        >
                          <b>{seat.id}번</b>
                          <span>{student?.number || "—"}</span>
                          <strong>
                            {student?.name ||
                              (seat.enabled ? "빈자리" : "사용 불가")}
                          </strong>
                        </div>
                      );
                    })}
                </div>
              ))}
              <div className="seat-print-front">
                <span>출입문</span>
                <strong>칠판 · 교탁 방향</strong>
                <span>운동장</span>
              </div>
            </section>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
