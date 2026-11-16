import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Snapshot } from "./domain";
import { farewellRecord } from "./farewell";
import { FarewellLetter } from "./FarewellLetter";
import "./farewell.css";

export function StudyFarewell({
  data,
  token,
  now,
  autoOpen,
  home,
}: {
  data: Snapshot;
  token: string | null;
  now: number;
  autoOpen: boolean;
  home: boolean;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [awards, setAwards] = useState<{
    crowns: number;
    stars: number;
  } | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const student = data.students[0];
  const record = farewellRecord(
    data.visits,
    student.id,
    now,
    data.settings.missing_hours,
  );
  const revision = data.visits
    .map((v) => `${v.id}:${v.exited_at ?? ""}`)
    .join("|");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError(false);
    api("weekly_ranking", { scope: "day" }, "student", token)
      .then((result) => {
        if (!alive) return;
        if (!result.mine?.collection) throw Error("수집 기록 없음");
        setAwards(result.mine.collection);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [open, token, student.id, revision, retry]);

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      {home && (
        <section className="farewell-home" aria-label="온실의 마지막 편지">
          <span aria-hidden="true">🍀</span>
          <div>
            <p>쌓아온 시간, 빛날 너의 내일</p>
            <small>나의 공부 기록과 온실이 보내는 응원 편지</small>
          </div>
          <button type="button" onClick={() => setOpen(true)}>
            나의 편지 열기
          </button>
        </section>
      )}
      {open && (
        <dialog
          ref={dialog}
          className="farewell-dialog"
          aria-labelledby="farewell-title"
          onClose={() => setOpen(false)}
        >
          <div className="farewell-toolbar">
            <span>TO. {student.name}</span>
            <button
              type="button"
              autoFocus
              onClick={() => setOpen(false)}
              aria-label="응원 편지 닫기"
            >
              닫기 <span aria-hidden="true">×</span>
            </button>
          </div>
          <FarewellLetter
            name={student.name}
            seconds={record.seconds}
            days={record.days}
            clovers={data.clovers ?? 0}
            awards={awards}
            awardsError={error}
            retry={() => setRetry((value) => value + 1)}
          />
          <div className="farewell-footer">
            <button
              type="button"
              className="primary"
              onClick={() => setOpen(false)}
            >
              응원 담고, 나의 홈으로
            </button>
            <small>홈에서 언제든 편지를 다시 볼 수 있어요.</small>
          </div>
        </dialog>
      )}
    </>
  );
}
