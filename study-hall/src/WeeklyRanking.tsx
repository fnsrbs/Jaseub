import { useEffect, useState } from "react";
import { api } from "./api";
import { duration, type Visit } from "./domain";
type Entry = {
  id?: string;
  name?: string;
  number?: string;
  rank: number | null;
  seconds: number;
  tied: boolean;
};
type Ranking = {
  participants: number;
  eligible: number;
  week_start: string;
  week_end: string;
  mine?: Entry;
  rows?: Entry[];
};
export function WeeklyRanking({
  role,
  token,
  visits,
}: {
  role: "teacher" | "viewer" | "student";
  token: string | null;
  visits: Visit[];
}) {
  const [ranking, setRanking] = useState<Ranking | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const result = await api("weekly_ranking", {}, role, token);
        if (alive) {
          setRanking(result);
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void refresh();
    const timer = setInterval(refresh, 30000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [role, token, visits]);
  const teacher = role !== "student";
  return (
    <section
      className="panel weekly-ranking"
      aria-label={teacher ? "이번 주 공부시간 순위표" : "이번 주 내 순위"}
    >
      <h2>{teacher ? "이번 주 공부시간 순위" : "이번 주 내 순위"}</h2>
      <p>월~금 · 퇴실 완료 기록으로 집계합니다. 같은 시간은 공동 순위입니다.</p>
      {error ? (
        <p role="alert" className="error-text">
          {error}
        </p>
      ) : !ranking ? (
        <p>순위를 불러오는 중입니다.</p>
      ) : teacher ? (
        <>
          <p>
            이번 주 기록이 있는 학생 {ranking.participants}명 · 활동 학생{" "}
            {ranking.eligible}명
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>순위</th>
                  <th>학번</th>
                  <th>이름</th>
                  <th>이번 주 확정 시간</th>
                </tr>
              </thead>
              <tbody>
                {ranking.rows?.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.rank
                        ? `${r.tied ? "공동 " : ""}${r.rank}위`
                        : "기록 없음"}
                    </td>
                    <td>{r.number}</td>
                    <td>{r.name}</td>
                    <td>{duration(r.seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!ranking.rows?.length && <p>등록된 활동 학생이 없습니다.</p>}
        </>
      ) : (
        <>
          <strong className="my-weekly-rank">
            {ranking.mine?.rank
              ? `${ranking.mine.tied ? "공동 " : ""}${ranking.mine.rank}위`
              : "아직 순위가 없어요"}
          </strong>
          {ranking.mine?.rank ? (
            <p>
              이번 주 참여 {ranking.participants}명 중 · 내 공부시간{" "}
              {duration(ranking.mine.seconds)}
            </p>
          ) : (
            <p>퇴실을 완료하면 이번 주 내 순위를 확인할 수 있어요.</p>
          )}
        </>
      )}
    </section>
  );
}
