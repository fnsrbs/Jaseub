import { useEffect, useRef, type ReactNode } from "react";
import "./farewell.css";

export function FarewellDialog({
  name,
  close,
  children,
  preview = false,
}: {
  name: string;
  close: () => void;
  children: ReactNode;
  preview?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element?.showModal();
    return () => {
      element?.close();
      document.body.style.overflow = overflow;
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="farewell-dialog"
      aria-labelledby="farewell-title"
      onClose={close}
    >
      <div className="farewell-toolbar">
        <span>{preview ? "관리자 미리보기 · 예시 기록" : `TO. ${name}`}</span>
        <button
          type="button"
          autoFocus
          onClick={close}
          aria-label="응원 편지 닫기"
        >
          닫기 <span aria-hidden="true">×</span>
        </button>
      </div>
      {children}
      <div className="farewell-footer">
        <button type="button" className="primary" onClick={close}>
          {preview ? "미리보기 닫기" : "응원 담고, 나의 홈으로"}
        </button>
        <small>
          {preview
            ? "저장 전 미리보기입니다. 기록과 이름은 예시입니다."
            : "홈에서 언제든 편지를 다시 볼 수 있어요."}
        </small>
      </div>
    </dialog>
  );
}
