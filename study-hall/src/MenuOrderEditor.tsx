import { useEffect, useState } from "react";
import { orderedMenu, type MenuRole, type MenuOrders } from "./menu-order";
export type MenuConfig = { orders: MenuOrders; revision: number };
export function MenuOrderEditor({
  config,
  onSaved,
  act,
  busy,
}: {
  config: MenuConfig | null;
  onSaved: (c: MenuConfig) => void;
  act: (a: string, p: any) => Promise<any>;
  busy: boolean;
}) {
  const [role, setRole] = useState<MenuRole>("student"),
    [draft, setDraft] = useState<MenuOrders>({}),
    [revision, setRevision] = useState(0),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (config && !dirty) {
      setDraft(config.orders);
      setRevision(config.revision);
    }
  }, [config, dirty]);
  const menu = orderedMenu(role, draft);
  const move = (index: number, delta: number) => {
    const keys = menu.map((m) => m[0]);
    [keys[index], keys[index + delta]] = [keys[index + delta], keys[index]];
    setDraft({ ...draft, [role]: keys });
    setDirty(true);
    setError("");
  };
  return (
    <section className="panel">
      <h2>역할별 메뉴 순서</h2>
      <p>학생·교사·관리자의 왼쪽 메뉴를 위아래로 옮긴 뒤 저장하세요.</p>
      <div className="tabs">
        {(
          [
            ["student", "학생"],
            ["viewer", "교사"],
            ["teacher", "관리자"],
          ] as const
        ).map(([r, label]) => (
          <button
            key={r}
            type="button"
            className={role === r ? "active" : ""}
            onClick={() => setRole(r)}
          >
            {label}
          </button>
        ))}
      </div>
      {!config ? (
        <p>메뉴 설정을 불러오는 중입니다.</p>
      ) : (
        <>
          <ol className="menu-order-list">
            {menu.map(([key, icon, label], i) => (
              <li key={key}>
                <span>
                  {icon} {label}
                </span>
                <div>
                  <button
                    type="button"
                    disabled={busy || i === 0}
                    aria-label={`${label} 위로`}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={busy || i === menu.length - 1}
                    aria-label={`${label} 아래로`}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                </div>
              </li>
            ))}
          </ol>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <div className="actions">
            <button
              className="primary"
              disabled={busy || !dirty}
              onClick={() => {
                setError("");
                void act("menu_order_save", {
                  orders: Object.fromEntries(
                    (["student", "viewer", "teacher"] as const).map((r) => [
                      r,
                      orderedMenu(r, draft).map((m) => m[0]),
                    ]),
                  ),
                  revision,
                })
                  .then((c) => {
                    onSaved(c);
                    setDraft(c.orders);
                    setRevision(c.revision);
                    setDirty(false);
                  })
                  .catch((e) => setError(e.message));
              }}
            >
              메뉴 순서 저장
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setDraft({ ...draft, [role]: [] });
                setDirty(true);
              }}
            >
              이 역할 기본 순서
            </button>
            <button
              type="button"
              disabled={busy || !dirty}
              onClick={() => {
                setDraft(config.orders);
                setRevision(config.revision);
                setDirty(false);
                setError("");
              }}
            >
              변경 취소
            </button>
          </div>
        </>
      )}
    </section>
  );
}
