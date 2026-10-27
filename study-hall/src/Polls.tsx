import { useEffect, useState } from "react";
import { api } from "./api";
import { pollWhileVisible } from "./visible-polling";

export type Poll = {
  id: string;
  title: string;
  options: string[];
  anonymous: boolean;
  closed: boolean;
  created_at: string;
  counts: number[];
  total: number;
  my_choice: number | null;
  voters: { number: string; name: string; choice: number }[];
};

export function Polls({
  role,
  token,
}: {
  role: "teacher" | "viewer" | "student";
  token: string | null;
}) {
  const [polls, setPolls] = useState<Poll[]>([]);
  const [title, setTitle] = useState("");
  const [options, setOptions] = useState("찬성\n반대");
  const [anonymous, setAnonymous] = useState(true);
  const [choices, setChoices] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let alive = true;
    const stop = pollWhileVisible(async () => {
      try {
        const rows = await api("polls", {}, role, token);
        if (alive) {
          setPolls(rows);
          setError("");
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    }, 15000);
    return () => {
      alive = false;
      stop();
    };
  }, [role, token]);
  async function submit(action: string, payload: unknown) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(action, payload, role, token);
      setPolls(await api("polls", {}, role, token));
      if (action === "poll_create") setTitle("");
      setMessage(
        action === "poll_vote"
          ? "투표에 참여했습니다."
          : action === "poll_close"
            ? "투표를 마감했습니다."
            : "투표를 만들었습니다.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="polls">
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {role === "teacher" && (
        <section className="panel">
          <h2>투표 만들기</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit("poll_create", {
                title,
                options: options
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
                anonymous,
              });
            }}
          >
            <label className="field">
              <span>투표 제목</span>
              <input
                required
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="이번 달 자리를 바꿀까요?"
              />
            </label>
            <label className="field">
              <span>선택지 · 한 줄에 하나, 2~10개</span>
              <textarea
                required
                rows={4}
                maxLength={1010}
                value={options}
                onChange={(e) => setOptions(e.target.value)}
              />
            </label>
            <label className="field">
              <span>응답 공개 방식</span>
              <select
                value={String(anonymous)}
                onChange={(e) => setAnonymous(e.target.value === "true")}
              >
                <option value="true">익명 투표</option>
                <option value="false">기명 투표</option>
              </select>
            </label>
            <p className="muted">
              익명은 집계만 공개합니다. 기명은 관리자에게 학번·이름·선택을
              공개합니다. 생성 후 공개 방식은 변경할 수 없습니다.
            </p>
            <button disabled={busy} type="submit">
              투표 만들기
            </button>
          </form>
        </section>
      )}
      {loading ? (
        <p role="status">투표를 불러오는 중…</p>
      ) : (
        polls.length === 0 && (
          <section className="panel">
            <p>아직 등록된 투표가 없습니다.</p>
          </section>
        )
      )}
      {polls.map((p) => (
        <section className="panel" key={p.id}>
          <h2>{p.title}</h2>
          <p className="muted">
            {p.closed ? "마감" : "진행 중"} · {p.anonymous ? "익명" : "기명"} ·{" "}
            {p.total}명 참여
          </p>
          <p>
            {p.anonymous
              ? "응답자 이름은 공개되지 않습니다."
              : "관리자가 학번·이름과 선택한 항목을 확인할 수 있습니다."}{" "}
            학생마다 한 번 참여할 수 있으며 제출 후 변경할 수 없습니다.
          </p>
          <fieldset
            disabled={
              busy || p.closed || p.my_choice !== null || role !== "student"
            }
          >
            <legend>선택 항목</legend>
            {p.options.map((label, i) => (
              <label className="poll-option" key={i}>
                {role === "student" && (
                  <input
                    type="radio"
                    name={`poll-${p.id}`}
                    checked={(p.my_choice ?? choices[p.id]) === i}
                    onChange={() => setChoices((c) => ({ ...c, [p.id]: i }))}
                  />
                )}
                <span>
                  {label}
                  {p.my_choice === i ? " · 내 선택" : ""}
                </span>
                <span>
                  {p.counts[i]}표 (
                  {p.total ? Math.round((p.counts[i] / p.total) * 100) : 0}%)
                </span>
              </label>
            ))}
          </fieldset>
          {role === "student" &&
            (p.my_choice !== null ? (
              <p role="status">참여 완료</p>
            ) : (
              !p.closed && (
                <button
                  disabled={busy || choices[p.id] === undefined}
                  onClick={() =>
                    void submit("poll_vote", {
                      id: p.id,
                      choice: choices[p.id],
                    })
                  }
                >
                  선택한 항목으로 투표
                </button>
              )
            ))}
          {role === "teacher" && !p.closed && (
            <button
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "투표를 마감하면 더 이상 참여할 수 없습니다. 마감할까요?",
                  )
                )
                  void submit("poll_close", { id: p.id });
              }}
            >
              투표 마감
            </button>
          )}
          {role === "teacher" && !p.anonymous && p.voters.length > 0 && (
            <details>
              <summary>기명 응답 보기 ({p.total}명)</summary>
              <ul>
                {p.voters.map((v) => (
                  <li key={v.number}>
                    {v.number} {v.name} · {p.options[v.choice]}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      ))}
    </div>
  );
}
