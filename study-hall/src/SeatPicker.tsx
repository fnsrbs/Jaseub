import type { Snapshot } from "./domain";
export function SeatPicker({
  data,
  available,
  selected,
  fixed,
  onChange,
}: {
  data: Snapshot;
  available: number[];
  selected: string[];
  fixed: string[];
  onChange: (ids: number[]) => void;
}) {
  const rows = [...new Set(data.seats.map((s) => s.row))].sort((a, b) => a - b);
  const locked = new Set(
    data.students
      .filter((s) => !selected.includes(s.id) || fixed.includes(s.id))
      .map((s) => s.seat_id),
  );
  const usable = data.seats.filter((s) => s.enabled && !locked.has(s.id));
  return (
    <details className="seat-picker-layout compact-seat-picker">
      <summary>
        사용할 좌석 · {usable.filter((s) => available.includes(s.id)).length}석
        선택 · 선택 펼치기
      </summary>
      <p>
        좌석 번호를 눌러 추첨 사용 여부만 선택합니다. 학생의 자리는 바뀌지
        않습니다.
      </p>
      <button type="button" onClick={() => onChange(usable.map((s) => s.id))}>
        사용 가능 좌석 전체 선택
      </button>
      <button type="button" onClick={() => onChange([])}>
        좌석 선택 해제
      </button>
      <div className="seat-scroll">
        <div className="seat-room">
          <div className="room-caption">사용할 좌석 배치도 · 두 자리씩 짝</div>
          {rows.map((row) => (
            <div
              key={row}
              className={`seat-row ${row === 5 ? "cross-aisle" : ""}`}
            >
              {data.seats
                .filter((s) => s.row === row)
                .sort((a, b) => a.col - b.col)
                .map((s) => {
                  const blocked = !s.enabled || locked.has(s.id);
                  const picked = !blocked && available.includes(s.id);
                  return (
                    <button
                      type="button"
                      key={s.id}
                      style={{ gridColumn: s.col }}
                      className={`seat ${picked ? "mine" : ""} ${blocked ? "disabled" : ""}`}
                      disabled={blocked}
                      aria-pressed={picked}
                      aria-label={`${s.id}번 좌석 ${blocked ? "선택 불가" : picked ? "선택됨" : "선택 안 됨"}`}
                      onClick={() =>
                        onChange(
                          picked
                            ? available.filter((id) => id !== s.id)
                            : [...available, s.id],
                        )
                      }
                    >
                      <b>{String(s.id).padStart(2, "0")}</b>
                      <small>
                        {!s.enabled
                          ? "사용 불가"
                          : locked.has(s.id)
                            ? "자리 유지"
                            : picked
                              ? "✓ 사용"
                              : "제외"}
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
    </details>
  );
}
