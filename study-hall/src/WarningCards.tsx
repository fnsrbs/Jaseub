import { useState } from "react";
import type { Snapshot } from "./domain";
export function WarningCards({
  data,
  canManage,
  studentId,
  busy,
  act,
}: {
  data: Snapshot;
  canManage: boolean;
  studentId?: string;
  busy: boolean;
  act: (a: string, p: any) => Promise<any>;
}) {
  const [student, setStudent] = useState("");
  const [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const students = data.students.filter(
    (s) => !s.deleted_at && (canManage || s.id === studentId),
  );
  const warnings = (data.warnings || []).filter(
    (w) => !w.deleted_at && (canManage || w.student_id === studentId),
  );
  const history = warnings
    .filter((w) => !student || w.student_id === student)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return (
    <>
      <div className="panel">
        <h2>{canManage ? "학생별 누적 경고카드" : "나의 경고카드"}</h2>
        {!canManage && (
          <p>
            <strong>누적 경고 {warnings.length}회</strong>
          </p>
        )}
        <p>
          카드 1회 발급마다 1장이 누적됩니다. 삭제된 카드는 누적에서 제외됩니다.
          발급 일시와 사유가 계속 보관됩니다.
        </p>
        {canManage && (
          <label className="field">
            <span>학생 선택 / 내역 필터</span>
            <select
              value={student}
              onChange={(e) => {
                setStudent(e.target.value);
                setRequestId(crypto.randomUUID());
              }}
            >
              <option value="">전체 학생</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.number} · 누적{" "}
                  {warnings.filter((w) => w.student_id === s.id).length}장
                </option>
              ))}
            </select>
          </label>
        )}
        {canManage && (
          <form
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void act("warning_issue", {
                student_id: student,
                reason,
                request_id: requestId,
              })
                .then(() => {
                  setReason("");
                  setRequestId(crypto.randomUUID());
                })
                .catch(() => {});
            }}
          >
            <label className="field">
              <span>경고 사유</span>
              <input
                required
                maxLength={1000}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setRequestId(crypto.randomUUID());
                }}
                placeholder="예: 자습 중 소란"
              />
            </label>
            <button
              className="warning-button"
              disabled={busy || !student || !reason.trim()}
            >
              경고카드 1장 발급
            </button>
          </form>
        )}
        {canManage && (
          <div className="warning-totals">
            {students
              .filter((s) => !s.deleted_at && (!student || s.id === student))
              .map((s) => (
                <button key={s.id} onClick={() => setStudent(s.id)}>
                  {s.name}{" "}
                  <strong>
                    ▣ {warnings.filter((w) => w.student_id === s.id).length}장
                  </strong>
                </button>
              ))}
          </div>
        )}
      </div>
      <div className="panel table-wrap">
        <h2>발급 내역 · {history.length}장</h2>
        {!history.length ? (
          <p>발급된 경고카드가 없습니다.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>학생</th>
                <th>학번</th>
                <th>발급 일시</th>
                <th>경고 사유</th>
                {canManage && <th>관리</th>}
              </tr>
            </thead>
            <tbody>
              {history.map((w) => {
                const s = data.students.find((s) => s.id === w.student_id);
                return (
                  <tr key={w.id}>
                    <td>{s?.name || "삭제된 학생"}</td>
                    <td>{s?.number || "—"}</td>
                    <td>
                      {new Date(w.created_at).toLocaleString("ko-KR", {
                        timeZone: "Asia/Seoul",
                      })}
                    </td>
                    <td className="warning-reason">{w.reason}</td>
                    {canManage && (
                      <td>
                        <button
                          disabled={busy}
                          onClick={() => {
                            const reason = prompt(
                              `${s?.name || "학생"} 경고카드 삭제 사유`,
                            );
                            if (!reason?.trim()) return;
                            if (
                              confirm(
                                "이 경고카드를 삭제할까요? 누적 장수에서 제외되며 삭제 이력은 보관됩니다.",
                              )
                            )
                              void act("warning_delete", {
                                id: w.id,
                                reason: reason.trim(),
                              }).catch(() => {});
                          }}
                        >
                          삭제
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
