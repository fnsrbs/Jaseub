import { useEffect, useState } from "react";
import { api } from "./api";
import type { Student } from "./domain";
import { dailyLabels as attendanceLabels } from "../supabase/functions/api/attendance-daily";
type AttendanceStatus = keyof typeof attendanceLabels;

type Counts = Record<AttendanceStatus, number> & {
  student_id: string;
  irregular_days: number;
  equivalent_absent: number;
  lifetime_absent: number;
  lifetime_irregular: number;
  lifetime_equivalent: number;
  removal_candidate: boolean;
  pending_days: number;
};
type RecordRow = {
  day: string;
  period: number | null;
  exempt_reason?: string;
  original_status?: string;
  exit_at?: string;
  status: AttendanceStatus;
  note: string;
};
type Result = { summaries: Counts[]; records: RecordRow[]; total: number };
export function AttendanceSummary({
  students,
  studentId,
}: {
  students: Student[];
  studentId?: string;
}) {
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
  }).format(new Date());
  const [range, setRange] = useState("month"),
    [start, setStart] = useState(today.slice(0, 7) + "-01"),
    [end, setEnd] = useState(today);
  const [selected, setSelected] = useState(studentId || ""),
    [offset, setOffset] = useState(0),
    [version, setVersion] = useState(0);
  const [result, setResult] = useState<Result | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const role = sessionStorage.getItem("sh-role") as
    "teacher" | "viewer" | "student";
  const own = role === "student";
  const roster = students
    .filter((s) => !s.deleted_at)
    .sort((a, b) => a.number.localeCompare(b.number, "ko", { numeric: true }));
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    setResult(null);
    api(
      "attendance_summary",
      { start, end, student_id: selected || undefined, offset },
      role,
      sessionStorage.getItem("sh-token"),
    )
      .then((r) => {
        if (alive) setResult(r);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [start, end, selected, offset, version, role]);
  function chooseRange(value: string) {
    setRange(value);
    setOffset(0);
    if (value === "custom") return;
    setEnd(today);
    const date = new Date(today + "T12:00:00Z");
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    setStart(
      value === "week"
        ? date.toISOString().slice(0, 10)
        : value === "month"
          ? today.slice(0, 7) + "-01"
          : "1900-01-01",
    );
  }
  const counts = result?.summaries.find(
    (s) => s.student_id === (selected || roster[0]?.id),
  );
  return (
    <section className="panel attendance-summary" aria-label="일별 출결 조회">
      <h2>{own ? "내 출결" : "학생별 출결"}</h2>
      <p>
        월·화 16:30 / 수·목·금 15:30 이후 모든 교시의 확인 기록을 날짜별 1일로
        집계합니다. 전 교시 결석은 결석, 일부 교시 불참은 기록 흐름에 따라
        지각·결과·조퇴로 구분합니다.
      </p>
      <div className="form-grid">
        <label className="field">
          <span>조회 기간</span>
          <select value={range} onChange={(e) => chooseRange(e.target.value)}>
            <option value="week">이번 주</option>
            <option value="month">이번 달</option>
            <option value="all">전체</option>
            <option value="custom">직접 선택</option>
          </select>
        </label>
        {range === "custom" && (
          <>
            <label className="field">
              <span>시작일</span>
              <input
                type="date"
                value={start}
                max={end}
                onChange={(e) => {
                  setStart(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <label className="field">
              <span>종료일</span>
              <input
                type="date"
                value={end}
                min={start}
                onChange={(e) => {
                  setEnd(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
          </>
        )}
        {!own && !studentId && (
          <label className="field">
            <span>학생 상세 조회</span>
            <select
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">전체 학생 일수</option>
              {roster.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number} {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          disabled={loading}
          onClick={() => setVersion((v) => v + 1)}
        >
          다시 조회
        </button>
      </div>
      {loading && <p role="status">조회 중…</p>}
      {error && <p role="alert">{error}</p>}
      {result && (
        <>
          {own || selected ? (
            <>
              <div className="attendance-counts">
                {(Object.keys(attendanceLabels) as AttendanceStatus[]).map(
                  (status) => (
                    <span className={`status-${status}`} key={status}>
                      <small>{attendanceLabels[status]}</small>
                      <strong>
                        {counts?.[status] || 0}
                        <small>{"일"}</small>
                      </strong>
                    </span>
                  ),
                )}
              </div>
              <p className="muted">
                지각·결과·조퇴는 같은 날 중복 없이 3일당 결석 1일로 환산합니다.
                인정결석도 포함하며, 면접고사·기타 제외 사유를 지정한 교시는
                퇴출 계산에서 제외합니다.
              </p>
              <p className="muted">
                같은 날 여러 유형이 있으면 조퇴·결과·지각 순으로 하루만
                집계하고, 상세기록에는 모두 표시합니다.
              </p>
              <div
                className={`alert ${counts?.removal_candidate ? "error" : ""}`}
              >
                <strong>
                  전체 운영 기간 · 환산 결석 {counts?.lifetime_equivalent || 0}
                  일 {counts?.removal_candidate ? "· 퇴출대상" : ""}
                </strong>
                <p>
                  결석 {counts?.lifetime_absent || 0}일 + 지각·결과·조퇴{" "}
                  {counts?.lifetime_irregular || 0}일 ÷ 3 (나머지 일수 이월)
                </p>
                <small>
                  환산 결석 3일 이상이면 퇴출대상으로 표시됩니다. 이용 제한은
                  자동으로 변경하지 않습니다.
                </small>
              </div>
              {!!counts?.pending_days && (
                <p role="status">
                  선택한 기간 중 {counts.pending_days}일은 확인하지 않은 교시가
                  있어 집계를 기다리고 있습니다.
                </p>
              )}
              <h3>지각·결과·조퇴·결석 상세기록 · {result.total}건</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>날짜</th>
                      <th>교시</th>
                      <th>출결</th>
                      <th>사유·메모</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.records.map((r) => (
                      <tr key={r.day + ":" + r.period}>
                        <td>{r.day}</td>
                        <td>
                          {r.period === null ? "하루 전체" : `${r.period}교시`}
                        </td>
                        <td>
                          {attendanceLabels[r.status]}
                          {r.exempt_reason && <small> · 집계 제외</small>}
                          {r.original_status === "excused" &&
                            r.status !== "excused" && (
                              <small> (인정결석)</small>
                            )}
                        </td>
                        <td
                          style={{
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {[
                            r.exempt_reason,
                            r.note,
                            r.exit_at
                              ? `퇴실 ${new Date(r.exit_at).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" })}`
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!result.total && (
                <p>이 기간에 집계된 지각·결과·조퇴·결석 기록이 없습니다.</p>
              )}
              {result.total > 100 && (
                <div className="form-grid">
                  <button
                    disabled={!offset}
                    onClick={() => setOffset(Math.max(0, offset - 100))}
                  >
                    이전
                  </button>
                  <span>
                    {offset + 1}–{Math.min(offset + 100, result.total)} /{" "}
                    {result.total}
                  </span>
                  <button
                    disabled={offset + 100 >= result.total}
                    onClick={() => setOffset(offset + 100)}
                  >
                    다음
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>학번·이름</th>
                    <th>누적 환산 결석 · 퇴출 기준</th>
                    {Object.values(attendanceLabels).map((label) => (
                      <th key={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {roster.map((s) => {
                    const c = result.summaries.find(
                      (c) => c.student_id === s.id,
                    );
                    return (
                      <tr key={s.id}>
                        <td>
                          <button
                            onClick={() => {
                              setSelected(s.id);
                              setOffset(0);
                            }}
                          >
                            <small>{s.number}</small>
                            <br />
                            {s.name}
                          </button>
                        </td>
                        <td>
                          <strong>{c?.lifetime_equivalent || 0}일</strong>
                          {c?.removal_candidate && (
                            <span className="error-text"> · 퇴출대상</span>
                          )}
                          {!!c?.pending_days && (
                            <small> · {c.pending_days}일 확인 필요</small>
                          )}
                        </td>
                        {(
                          Object.keys(attendanceLabels) as AttendanceStatus[]
                        ).map((status) => (
                          <td key={status}>
                            {c?.[status] || 0}
                            {"일"}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
