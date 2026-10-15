import { useEffect, useState } from "react";
import { api } from "./api";
export function SeatSheetSync({
  hasDraft,
  busy,
  act,
}: {
  hasDraft: boolean;
  busy: boolean;
  act: (action: string, payload: any) => Promise<any>;
}) {
  const [status, setStatus] = useState<{
    configured: boolean;
    endpoint: string;
    last_synced_at: string | null;
  } | null>(null);
  const [open, setOpen] = useState(false),
    [code, setCode] = useState(""),
    [endpoint, setEndpoint] = useState("");
  const [working, setWorking] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    void api("sheet_sync_status", {}, "teacher")
      .then((r) => {
        setStatus(r);
        setEndpoint(r.endpoint || "");
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  const downloadCode = () => {
    const url = URL.createObjectURL(
      new Blob([code], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "Jaseub-seat-sync.gs";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="sheet-sync">
      <div className="actions">
        <button
          type="button"
          disabled={busy || working || !status?.configured || hasDraft}
          onClick={() => {
            if (
              !confirm(
                "확정된 좌석 배정을 구글 시트에 반영할까요? 좌석표의 학번·이름 72칸을 갱신하고, 빈자리는 비웁니다.",
              )
            )
              return;
            setWorking(true);
            setError("");
            setMessage("");
            void act("sheet_sync", {})
              .then((r) => {
                setStatus((current) =>
                  current
                    ? { ...current, last_synced_at: r.last_synced_at }
                    : current,
                );
                setMessage(
                  r.demo
                    ? "데모 확인 완료 · 실제 구글 시트는 변경되지 않았습니다."
                    : "구글 시트에 확정 좌석 배정을 반영했습니다.",
                );
              })
              .catch((e) => setError((e as Error).message))
              .finally(() => setWorking(false));
          }}
        >
          {working ? "처리 중…" : "구글 시트에 반영"}
        </button>
        <button type="button" onClick={() => setOpen(!open)}>
          구글 시트 연결 설정
        </button>
        {status?.last_synced_at && (
          <small>
            최근 반영:{" "}
            {new Date(status.last_synced_at).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
            })}
          </small>
        )}
      </div>
      {hasDraft && <small>미리보기 배정을 먼저 확정한 뒤 반영하세요.</small>}
      {status && !status.configured && (
        <p>처음 한 번 구글 시트 연결을 완료하면 사용할 수 있습니다.</p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {open && (
        <div className="panel">
          <h3>구글 시트 연결 · 최초 1회</h3>
          <ol>
            <li>아래에서 연결 코드를 준비합니다.</li>
            <li>
              <a
                href="https://script.google.com/home/start"
                target="_blank"
                rel="noreferrer"
              >
                Google Apps Script
              </a>
              에서 새 프로젝트를 만들고, Code.gs의 내용을 연결 코드로 바꿉니다.
            </li>
            <li>
              배포 → 새 배포 → 웹 앱에서{" "}
              <b>실행 사용자: 나 / 액세스: 모든 사용자</b>로 배포하고 구글
              권한을 승인합니다. 앱 서버의 서명이 있는 요청만 좌석표를 변경할 수
              있습니다.
            </li>
            <li>발급된 웹 앱 URL을 아래에 붙여 넣어 연결합니다.</li>
          </ol>
          <button
            type="button"
            disabled={working || busy}
            onClick={() => {
              setWorking(true);
              setError("");
              void api("sheet_sync_setup", {}, "teacher")
                .then((r) => setCode(r.script))
                .catch((e) => setError((e as Error).message))
                .finally(() => setWorking(false));
            }}
          >
            연결 코드 준비
          </button>
          {code && (
            <>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(code)
                    .then(() => setMessage("연결 코드를 복사했습니다."))
                    .catch(() =>
                      setError(
                        "코드를 직접 선택해 복사하거나 파일로 내려받으세요.",
                      ),
                    );
                }}
              >
                코드 복사
              </button>
              <button type="button" onClick={downloadCode}>
                코드 내려받기
              </button>
              <label className="field">
                <span>연결 코드 · 관리자만 확인 가능</span>
                <textarea rows={6} readOnly value={code} />
              </label>
            </>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setWorking(true);
              setError("");
              void act("sheet_sync_configure", { endpoint })
                .then((r) => {
                  setStatus(r);
                  setCode("");
                  setOpen(false);
                  setMessage(
                    "구글 시트 연결을 확인했습니다. 이제 반영 버튼을 사용할 수 있습니다.",
                  );
                })
                .catch((e) => setError((e as Error).message))
                .finally(() => setWorking(false));
            }}
          >
            <label className="field">
              <span>Apps Script 웹 앱 배포 URL</span>
              <input
                type="url"
                required
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://script.google.com/macros/s/…/exec"
              />
            </label>
            <button className="primary" disabled={busy || working}>
              연결 확인 및 저장
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
