import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { rankingTime } from "./study-ranking";
import type { Visit } from "./domain";

export type CollectionCounts = {
  crowns: number;
  stars: number;
  clovers: number;
};
type Kind = keyof CollectionCounts;
const labels = { crowns: "👑 왕관", stars: "⭐ 별", clovers: "🍀 클로버" };
type History = {
  total: number;
  records: { day: string; rank: number | null; seconds: number | null }[];
};
export function HomeCollectedRecords({
  clovers,
  token,
  visits,
}: {
  clovers: number;
  token: string | null;
  visits: Visit[];
}) {
  const [counts, setCounts] = useState<CollectionCounts | null>(null);
  const revision = visits.map((v) => `${v.id}:${v.exited_at ?? ""}`).join("|");
  useEffect(() => {
    let alive = true;
    api("weekly_ranking", { scope: "day" }, "student", token)
      .then((r) => {
        if (alive) setCounts(r.mine?.collection ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token, revision, clovers]);
  return (
    <CollectedRecords
      onlyClovers
      value={{
        crowns: counts?.crowns ?? 0,
        stars: counts?.stars ?? 0,
        clovers,
      }}
      role="student"
      token={token}
    />
  );
}
export function CollectedRecords({
  value,
  role,
  token,
  studentId,
  onlyClovers = false,
}: {
  value?: CollectionCounts;
  role: "teacher" | "viewer" | "student";
  token: string | null;
  studentId?: string;
  onlyClovers?: boolean;
}) {
  const [kind, setKind] = useState<Kind | null>(null);
  return (
    <>
      <div
        className={onlyClovers ? "home-clovers" : "ranking-collection"}
        aria-label={onlyClovers ? "출석 클로버" : "누적 수집 개수"}
      >
        {(onlyClovers
          ? ([
              "clovers",
              ...(value?.crowns ? ["crowns"] : []),
              ...(value?.stars ? ["stars"] : []),
            ] as Kind[])
          : (Object.keys(labels) as Kind[])
        ).map((k) => (
          <button
            type="button"
            key={k}
            onClick={() => setKind(k)}
            aria-label={`${labels[k]} ${value?.[k] ?? 0}개 획득 기록 보기`}
          >
            {onlyClovers && k === "clovers" ? "🍀 출석 클로버" : labels[k]}{" "}
            <strong>{value?.[k] ?? 0}개</strong>
          </button>
        ))}
        {onlyClovers && (
          <small>
            출석 클로버는 하루 1개씩 쌓여요. 눌러서 언제 모았는지 확인하세요.
          </small>
        )}
      </div>
      {kind && (
        <HistoryDialog
          kind={kind}
          role={role}
          token={token}
          studentId={studentId}
          close={() => setKind(null)}
        />
      )}
    </>
  );
}
function HistoryDialog({
  kind,
  role,
  token,
  studentId,
  close,
}: {
  kind: Kind;
  role: "teacher" | "viewer" | "student";
  token: string | null;
  studentId?: string;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [history, setHistory] = useState<History | null>(null),
    [error, setError] = useState(""),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, []);
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setError("");
    setHistory(null);
    api(
      "collection_history",
      { kind, student_id: studentId, offset },
      role,
      token,
    )
      .then((r) => {
        if (alive) setHistory(r);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [kind, studentId, role, token, offset]);
  return (
    <dialog
      ref={dialog}
      className="collection-history"
      aria-label={labels[kind] + " 획득 기록"}
      onClose={close}
    >
      <div className="collection-history-heading">
        <h2>{labels[kind]} 획득 기록</h2>
        <button type="button" onClick={() => dialog.current?.close()}>
          닫기
        </button>
      </div>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : busy || !history ? (
        <p>기록을 불러오는 중입니다.</p>
      ) : (
        <>
          <p>총 {history.total}개 · 최근 날짜순</p>
          {!history.records.length ? (
            <p>아직 모은 기록이 없어요.</p>
          ) : (
            <ul className="collection-history-list">
              {history.records.map((r) => (
                <li key={r.day}>
                  <time dateTime={r.day}>{r.day.replaceAll("-", ".")}</time>
                  <span>
                    {kind === "clovers"
                      ? "출석 · 클로버 1개"
                      : `하루 ${r.rank}위 · ${rankingTime(r.seconds ?? 0)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {(offset > 0 || offset + 50 < history.total) && (
            <div className="actions">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                이전
              </button>
              <span>
                {Math.floor(offset / 50) + 1} / {Math.ceil(history.total / 50)}
              </span>
              <button
                disabled={offset + 50 >= history.total}
                onClick={() => setOffset(offset + 50)}
              >
                다음
              </button>
            </div>
          )}
        </>
      )}
    </dialog>
  );
}
