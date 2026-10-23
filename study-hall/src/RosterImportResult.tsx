import { useId, useRef } from "react";

type Person = { id: string; number: string; name: string };
export type RosterImportSummary = {
  added: number;
  stopped: number;
  restored: number;
  students: Person[];
  participation_changes: (Person & {
    kind: "stopped" | "restored";
    active: boolean;
    previous_seat: number | null;
  })[];
};

export function RosterImportResult({
  result,
  onClose,
}: {
  result: RosterImportSummary;
  onClose: () => void;
}) {
  const titleId = useId();
  const confirmButton = useRef<HTMLButtonElement>(null);
  const rows = [
    ...result.students.map((s) => ({
      ...s,
      change: "신규 추가",
      detail: "좌석 미배정",
    })),
    ...result.participation_changes.map((s) => ({
      ...s,
      change: s.kind === "stopped" ? "참여 중단" : "중단 해제",
      detail:
        s.kind === "stopped"
          ? s.previous_seat
            ? `${s.previous_seat}번 좌석 해제 · 이용 중지`
            : "이용 중지"
          : s.active
            ? "참여 복구 · 좌석 재배정 필요"
            : "기존 이용 중지 유지",
    })),
  ];
  return (
    <div className="modal-backdrop">
      <div
        className="modal roster-import-result"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
          if (e.key === "Tab") {
            e.preventDefault();
            confirmButton.current?.focus();
          }
        }}
      >
        <h2 id={titleId}>구글 명단 불러오기 완료</h2>
        <p>
          신규 추가 {result.added}명 · 참여 중단 {result.stopped}명 · 중단 해제{" "}
          {result.restored}명
        </p>
        {rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>학번</th>
                  <th>이름</th>
                  <th>변경 내용</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={`${s.id}-${s.change}`}>
                    <td>{s.number}</td>
                    <td>{s.name}</td>
                    <td>
                      <strong>{s.change}</strong>
                      <small>{s.detail}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>변경된 학생이 없습니다. 기존 명단과 동일합니다.</p>
        )}
        {!!rows.length && <p>기존 출결·경고 기록은 보존했습니다.</p>}
        <button
          type="button"
          className="primary"
          autoFocus
          ref={confirmButton}
          onClick={onClose}
        >
          확인
        </button>
      </div>
    </div>
  );
}
