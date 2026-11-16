import { useEffect, useState } from "react";
import { FarewellLetter } from "./FarewellLetter";
import { FarewellDialog } from "./FarewellDialog";
import { FarewellInvitation } from "./FarewellInvitation";
import {
  defaultFarewellCopy,
  readFarewellCopy,
  validateFarewellCopy,
  type FarewellCopy,
} from "./farewell-copy";
import type { SiteCopy } from "./site-copy";
import "./farewell.css";

const fields: [keyof FarewellCopy, string, number][] = [
  ["farewell_eyebrow", "제목 위 안내 문구", 2],
  ["farewell_title", "편지 제목", 2],
  ["farewell_body", "편지 본문", 15],
  ["farewell_wish", "마지막 응원 문구", 2],
  ["farewell_medal_label", "트로피 위 안내 문구", 1],
  ["farewell_medal_title", "트로피 이름", 2],
  ["farewell_medal_body", "트로피 설명", 2],
  ["farewell_signature", "보내는 이 · 서명", 2],
];
const example = {
  name: "우리 학생",
  seconds: 142 * 3600 + 35 * 60,
  days: 24,
  clovers: 17,
  awards: { crowns: 3, stars: 8 },
  awardsError: false,
  retry() {},
};

export function FarewellEditor({
  copy,
  onSaved,
  act,
  busy,
}: {
  copy: SiteCopy;
  onSaved: (copy: SiteCopy) => void;
  act: (action: string, payload: unknown) => Promise<any>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(() => readFarewellCopy(copy));
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState(false);
  const [previewLetter, setPreviewLetter] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(readFarewellCopy(copy));
  }, [copy, dirty]);
  const change = (key: keyof FarewellCopy, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setSaved(false);
    setError("");
  };
  return (
    <>
      <div className="panel farewell-editor-intro">
        <div>
          <h2>마지막 날, 학생에게 보내는 편지</h2>
          <p>
            문구를 바꾸면 오른쪽 미리보기에 바로 반영됩니다. 저장하면 학생에게도
            반영됩니다.
          </p>
          <p className="muted">
            미리보기 이름·시간·수집 개수는 예시입니다. 실제 학생에게는 본인
            기록이 표시됩니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setPreviewLetter(false);
            setPreview(true);
          }}
        >
          학생 화면처럼 미리보기
        </button>
      </div>
      <div className="farewell-editor-layout">
        <form
          className="panel farewell-editor-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            setSaved(false);
            try {
              validateFarewellCopy(draft);
              const result = await act("site_copy", { copy: draft });
              onSaved(result);
              setDirty(false);
              setSaved(true);
            } catch (reason) {
              setError((reason as Error).message);
            }
          }}
        >
          <fieldset disabled={busy}>
            <legend>표시 설정과 편지 내용</legend>
            <label className="farewell-enabled">
              <input
                type="checkbox"
                checked={draft.farewell_enabled === "true"}
                onChange={(event) =>
                  change("farewell_enabled", String(event.target.checked))
                }
              />
              학생에게 편지 표시
            </label>
            <label className="field">
              <span>자동 표시 날짜 (한국 시간)</span>
              <input
                type="date"
                required
                value={draft.farewell_date}
                onChange={(event) =>
                  change("farewell_date", event.target.value)
                }
              />
            </label>
            <p className="muted">
              지정한 날 로그인하면 ‘마지막 편지 읽기’ 안내가 뜨고, 누르면 편지가
              펼쳐집니다. 다음 날부터는 홈에서 읽을 수 있습니다. 표시를 끄면
              학생 화면에서 숨겨집니다.
            </p>
            {fields.map(([key, label, rows]) => (
              <label key={key} className="field">
                <span>{label}</span>
                <textarea
                  aria-label={label}
                  rows={rows}
                  maxLength={2000}
                  value={draft[key]}
                  required={
                    key === "farewell_title" || key === "farewell_medal_title"
                  }
                  onChange={(event) => change(key, event.target.value)}
                />
              </label>
            ))}
            <p className="muted">
              본문에서 Enter는 줄바꿈, 빈 줄은 문단 구분입니다. 각 항목은
              2000자까지 입력할 수 있습니다.
            </p>
            <div className="actions">
              <button className="primary" type="submit">
                {busy ? "저장 중…" : "편지 저장"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft({ ...defaultFarewellCopy });
                  setDirty(true);
                  setSaved(false);
                  setError("");
                }}
              >
                기본 편지 불러오기
              </button>
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className="farewell-save-success">
              편지를 저장했습니다. 학생 화면에도 반영됩니다.
            </p>
          )}
          {dirty && (
            <p className="muted">아직 저장하지 않은 변경이 있습니다.</p>
          )}
        </form>
        <section
          className="farewell-editor-preview"
          aria-label="편지 실시간 미리보기"
        >
          <div className="farewell-preview-heading">
            <strong>실시간 미리보기</strong>
            <small>예시 학생 · 예시 기록</small>
          </div>
          <FarewellLetter
            {...example}
            copy={draft}
            titleId="farewell-preview-title"
          />
        </section>
      </div>
      {preview && (
        <FarewellDialog
          name={example.name}
          preview
          invitation={!previewLetter}
          close={() => setPreview(false)}
        >
          {previewLetter ? (
            <FarewellLetter {...example} copy={draft} />
          ) : (
            <FarewellInvitation
              name={example.name}
              read={() => setPreviewLetter(true)}
            />
          )}
        </FarewellDialog>
      )}
    </>
  );
}
