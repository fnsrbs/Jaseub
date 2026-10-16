import { useEffect, useState } from "react";
import { api } from "./api";
import type { Student } from "./domain";
import { attendanceLabels, type AttendanceStatus } from "./period-attendance";

type Counts = Record<AttendanceStatus, number> & { student_id: string };
type RecordRow = {
  day: string;
  period: number;
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
    <section className="panel attendance-summary" aria-label="교시별 출결 조회">
      <h2>{own ? "내 출결" : "학생별 출결"}</h2>
      <p>
        출석은 하루 1일로, 지각·결석·인정결석은 교시별 1회로 집계합니다. 확인
        완료한 기록만 포함합니다.
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
              <option value="">전체 학생 횟수</option>
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
                        <small>{status === "present" ? "일" : "회"}</small>
                      </strong>
                    </span>
                  ),
                )}
              </div>
              <h3>지각·결석·인정결석 기록 · {result.total}건</h3>
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
                        <td>{r.period}교시</td>
                        <td>{attendanceLabels[r.status]}</td>
                        <td
                          style={{
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {r.note || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!result.total && (
                <p>이 기간에 지각·결석·인정결석 기록이 없습니다.</p>
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
                        {(
                          Object.keys(attendanceLabels) as AttendanceStatus[]
                        ).map((status) => (
                          <td key={status}>
                            {c?.[status] || 0}
                            {status === "present" ? "일" : "회"}
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
