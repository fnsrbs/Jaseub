import { useEffect, useState } from "react";
import { api } from "./api";
import type { Snapshot } from "./domain";
import { farewellRecord } from "./farewell";
import { FarewellLetter } from "./FarewellLetter";
import { FarewellDialog } from "./FarewellDialog";
import { readFarewellCopy } from "./farewell-copy";
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
  const student = data.students[0];
  const copy = readFarewellCopy(data.settings.site_copy);
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

  return (
    <>
      {home && (
        <section className="farewell-home" aria-label="온실의 마지막 편지">
          <span aria-hidden="true">🍀</span>
          <div>
            <p>{copy.farewell_title.replaceAll("\n", " ")}</p>
            <small>나의 공부 기록과 온실이 보내는 응원 편지</small>
          </div>
          <button type="button" onClick={() => setOpen(true)}>
            나의 편지 열기
          </button>
        </section>
      )}
      {open && (
        <FarewellDialog name={student.name} close={() => setOpen(false)}>
          <FarewellLetter
            name={student.name}
            seconds={record.seconds}
            days={record.days}
            clovers={data.clovers ?? 0}
            awards={awards}
            awardsError={error}
            retry={() => setRetry((value) => value + 1)}
            copy={copy}
          />
        </FarewellDialog>
      )}
    </>
  );
}
