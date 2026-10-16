import { pollWhileVisible } from "./visible-polling";
import { useEffect, useState } from "react";
import { api } from "./api";
import { type Visit } from "./domain";
import { rankingTime } from "./study-ranking";
type Entry = {
  id?: string;
  name?: string;
  number?: string;
  rank: number | null;
  seconds: number;
  tied: boolean;
  tied_count: number;
  leader_gap_seconds: number | null;
};
type Ranking = {
  participants: number;
  eligible: number;
  average_seconds: number;
  scope: "day" | "week";
  period_start: string;
  period_end: string;
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
  const [scope, setScope] = useState<"day" | "week">("week");
  const period = scope === "day" ? "오늘" : "이번 주";
  const [ranking, setRanking] = useState<Ranking | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setRanking((previous) => (previous?.scope === scope ? previous : null));
    setError("");
    const refresh = async () => {
      try {
        const result = await api("weekly_ranking", { scope }, role, token);
        if (alive) {
          setRanking(result);
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    const stopPolling = pollWhileVisible(refresh, 30000);
    return () => {
      alive = false;
      stopPolling();
    };
  }, [role, token, visits, scope]);
  const teacher = role !== "student";
  return (
    <section
      className="panel weekly-ranking"
      aria-label={teacher ? `${period} 공부시간 순위표` : `${period} 내 순위`}
    >
      <h2>{teacher ? `${period} 공부시간 순위` : `${period} 내 순위`}</h2>
      <div className="ranking-tabs" role="group" aria-label="순위 조회 기간">
        <button
          type="button"
          aria-pressed={scope === "day"}
          onClick={() => setScope("day")}
        >
          오늘
        </button>
        <button
          type="button"
          aria-pressed={scope === "week"}
          onClick={() => setScope("week")}
        >
          이번 주
        </button>
      </div>
      <p>
        {scope === "day" ? "오늘" : "월~금"} · 퇴실 처리된 기록으로 집계합니다.
        같은 공부시간은 공동 순위입니다.
      </p>
      <p>
        월·화 16:30 / 수·목·금 15:30에 자동으로 퇴실 처리됩니다.
      </p>
      <p className="ranking-encouragement">
        자신의 속도에 맞춰 꾸준히 공부해 주세요. 오늘 쌓은 작은 노력이 내일의
        나를 한 걸음 더 나아가게 합니다.
      </p>
      {error ? (
        <p role="alert" className="error-text">
          {error}
        </p>
      ) : !ranking ? (
        <p>순위를 불러오는 중입니다.</p>
      ) : teacher ? (
        <>
          <p>
            {period} 기록이 있는 학생 {ranking.participants}명 · 활동 학생{" "}
            {ranking.eligible}명 · 참여 학생 평균{" "}
            {rankingTime(ranking.average_seconds)}
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>순위</th>
                  <th>학번</th>
                  <th>이름</th>
                  <th>{period} 공부시간</th>
                  <th>같은 시간 인원</th>
                  <th>1등과의 차이</th>
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
                    <td>{rankingTime(r.seconds)}</td>
                    <td>{r.tied_count ? `${r.tied_count}명` : "—"}</td>
                    <td>
                      {r.leader_gap_seconds === null
                        ? "—"
                        : r.leader_gap_seconds === 0
                          ? "차이 없음"
                          : rankingTime(r.leader_gap_seconds)}
                    </td>
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
            <>
              <p>
                {period} 참여 {ranking.participants}명 중
              </p>
              <div className="ranking-stats">
                <div>
                  <small>내 공부시간</small>
                  <strong>{rankingTime(ranking.mine.seconds)}</strong>
                </div>
                <div>
                  <small>같은 공부시간</small>
                  <strong>{ranking.mine.tied_count}명</strong>
                  <small>나 포함</small>
                </div>
                <div>
                  <small>1등과의 시간 차이</small>
                  <strong>
                    {ranking.mine.leader_gap_seconds === 0
                      ? "차이 없음"
                      : rankingTime(ranking.mine.leader_gap_seconds || 0)}
                  </strong>
                  {ranking.mine.rank === 1 && (
                    <small>
                      {ranking.mine.tied ? "공동 1등이에요" : "현재 1등이에요"}
                    </small>
                  )}
                </div>
                <div>
                  <small>참여 학생 평균 공부시간</small>
                  <strong>{rankingTime(ranking.average_seconds)}</strong>
                  <small>퇴실 기록이 있는 학생 기준</small>
                </div>
              </div>
            </>
          ) : (
            <>
              <p>
                자동 퇴실 또는 중간 퇴실 기록이 반영되면 {period} 내 순위를
                확인할 수 있어요.
              </p>
              {ranking.participants > 0 && (
                <p>
                  참여 학생 평균 공부시간:{" "}
                  {rankingTime(ranking.average_seconds)} (퇴실 기록이 있는 학생
                  기준)
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
