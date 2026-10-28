import { useEffect, useRef, type ReactNode } from "react";

export function SeatSettingsDialog({
  children,
  busy,
  onClose,
}: {
  children: ReactNode;
  busy: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="seat-settings-dialog"
      aria-labelledby="seat-settings-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="student-toolbar">
        <h2 id="seat-settings-title">좌석 사용 여부·사유 관리</h2>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          aria-label="좌석 설정 닫기"
        >
          닫기
        </button>
      </div>
      {children}
    </dialog>
  );
}
