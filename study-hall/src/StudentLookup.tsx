import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Snapshot, Student } from "./domain";
import { api } from "./api";
import type { CollectionCounts } from "./CollectedRecords";
function StudentCollectionSummary({ studentId }: { studentId: string }) {
  const [counts, setCounts] = useState<CollectionCounts | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const role = sessionStorage.getItem("sh-role") as "teacher" | "viewer";
    const token = sessionStorage.getItem("sh-token");
    api("weekly_ranking", { scope: "day" }, role, token)
      .then((ranking) => {
        if (!alive) return;
        const collection = ranking.rows?.find(
          (r: { id: string }) => r.id === studentId,
        )?.collection;
        if (collection) setCounts(collection);
        else setError("현재 수집 기록 집계 대상이 아닙니다.");
      })
      .catch(() => {
        if (alive) setError("수집 개수를 불러오지 못했습니다.");
      });
    return () => {
      alive = false;
    };
  }, [studentId]);
  return (
    <p className="student-collection-summary" aria-label="학생 누적 수집 개수">
      {counts ? (
        <>
          <span>
            👑 왕관 <strong>{counts.crowns}개</strong>
          </span>
          <span>
            ⭐ 별 <strong>{counts.stars}개</strong>
          </span>
          <span>
            🍀 클로버 <strong>{counts.clovers}개</strong>
          </span>
        </>
      ) : (
        error || "수집 개수를 불러오는 중입니다."
      )}
    </p>
  );
}
export function StudentLookup({
  data,
  renderDetails,
  initialSelectedId = "",
  onClose,
}: {
  data: Snapshot;
  renderDetails: (student: Student) => ReactNode;
  initialSelectedId?: string;
  onClose?: () => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(initialSelectedId);
  const listScroll = useRef(0);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!onClose) window.scrollTo({ top: selected ? 0 : listScroll.current });
    if (selected) detailHeading.current?.focus({ preventScroll: true });
  }, [selected]);
  const students = data.students
    .filter(
      (s) => !s.deleted_at && `${s.name} ${s.number}`.includes(search.trim()),
    )
    .sort(
      (a, b) =>
        a.number.localeCompare(b.number, "ko", { numeric: true }) ||
        a.name.localeCompare(b.name, "ko"),
    );
  const student = data.students.find((s) => s.id === selected && !s.deleted_at);
  return (
    <>
      {!student && (
        <div className="panel">
          <h2>학생 조회</h2>
          <p>
            이름을 누르면 학생별 이용 통계와 최근 출결·경고 내역을 확인할 수
            있습니다.
          </p>
          <label className="field">
            <span>이름·학번 검색</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="학생 검색"
            />
          </label>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>학번</th>
                  <th>이름</th>
                  <th>성별</th>
                  <th>좌석</th>
                  <th>이용 상태</th>
                  <th>현재 출결</th>
                  <th>누적 경고</th>
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.id}>
                    <td>{s.number}</td>
                    <td>
                      <button
                        type="button"
                        aria-pressed={selected === s.id}
                        onClick={() => {
                          listScroll.current = window.scrollY;
                          setSelected(s.id);
                        }}
                      >
                        {s.name} · 상세 보기
                      </button>
                    </td>
                    <td>
                      {s.gender === "male"
                        ? "남자"
                        : s.gender === "female"
                          ? "여자"
                          : "미확인"}
                    </td>
                    <td>{s.seat_id ? `${s.seat_id}번` : "미배정"}</td>
                    <td>{s.active ? "이용 가능" : "이용 중지"}</td>
                    <td>
                      {data.visits.some(
                        (v) => v.student_id === s.id && !v.exited_at,
                      )
                        ? "입실 중"
                        : "퇴실"}
                    </td>
                    <td>
                      {
                        (data.warnings || []).filter(
                          (w) => w.student_id === s.id && !w.deleted_at,
                        ).length
                      }
                      장
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!students.length && <p>검색 결과가 없습니다.</p>}
          </div>
        </div>
      )}
      {student && (
        <section aria-label={`${student.name} 학생 상세`}>
          <div className="panel">
            <button
              type="button"
              onClick={() => (onClose ? onClose() : setSelected(""))}
            >
              {onClose ? "← 운영현황으로 돌아가기" : "← 학생 목록으로"}
            </button>
            <h2 ref={detailHeading} tabIndex={-1}>
              {student.number} · {student.name}
            </h2>
            <p>
              좌석 {student.seat_id || "미배정"} ·{" "}
              {student.active ? "이용 가능" : "이용 중지"} · 누적 경고{" "}
              {
                (data.warnings || []).filter(
                  (w) => w.student_id === student.id && !w.deleted_at,
                ).length
              }
              장
            </p>
            <StudentCollectionSummary key={student.id} studentId={student.id} />
          </div>
          {renderDetails(student)}
          <div className="panel table-wrap">
            <h3>최근 출결 · 최대 10건</h3>
            <table>
              <thead>
                <tr>
                  <th>입실</th>
                  <th>퇴실</th>
                </tr>
              </thead>
              <tbody>
                {data.visits
                  .filter((v) => v.student_id === student.id)
                  .sort((a, b) => b.entered_at.localeCompare(a.entered_at))
                  .slice(0, 10)
                  .map((v) => (
                    <tr key={v.id}>
                      <td>
                        {new Date(v.entered_at).toLocaleString("ko-KR", {
                          timeZone: "Asia/Seoul",
                        })}
                      </td>
                      <td>
                        {v.exited_at
                          ? new Date(v.exited_at).toLocaleString("ko-KR", {
                              timeZone: "Asia/Seoul",
                            })
                          : "입실 중"}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!data.visits.some((v) => v.student_id === student.id) && (
              <p>출결 기록이 없습니다.</p>
            )}
          </div>
          <div className="panel">
            <h3>경고카드 내역</h3>
            {(data.warnings || [])
              .filter((w) => w.student_id === student.id && !w.deleted_at)
              .sort((a, b) => b.created_at.localeCompare(a.created_at))
              .map((w) => (
                <p key={w.id}>
                  {new Date(w.created_at).toLocaleString("ko-KR", {
                    timeZone: "Asia/Seoul",
                  })}{" "}
                  · {w.reason}
                </p>
              ))}
            {!(data.warnings || []).some(
              (w) => w.student_id === student.id && !w.deleted_at,
            ) && <p>발급된 경고카드가 없습니다.</p>}
          </div>
        </section>
      )}
    </>
  );
}
