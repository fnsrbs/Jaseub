export type MenuRole = "student" | "viewer" | "teacher";
export type MenuOrders = Partial<Record<MenuRole, string[]>>;
export type MenuItem = [string, string, string];
export const defaultMenus: Record<MenuRole, MenuItem[]> = {
  teacher: [
    ["home", "▦", "운영 대시보드"],
    ["attendance", "✓", "출석관리"],
    ["ranking", "♛", "공부시간 순위"],
    ["supervision", "▦", "감독표 관리"],
    ["cleaning", "♧", "청소 당번 관리"],
    ["students", "♙", "학생 관리"],
    ["seats", "▤", "좌석 관리"],
    ["warnings", "▣", "경고카드"],
    ["records", "◷", "출결 기록"],
    ["qr", "▣", "현장 QR"],
    ["notices", "♧", "공지사항"],
    ["suggestions", "✉", "건의사항"],
    ["stats", "▥", "이용 통계"],
    ["settings", "⚙", "운영 설정"],
  ],
  viewer: [
    ["home", "▦", "운영 현황"],
    ["attendance", "✓", "출석관리"],
    ["ranking", "♛", "공부시간 순위"],
    ["supervision", "▦", "감독 조회"],
    ["cleaning", "♧", "청소 당번표"],
    ["student-lookup", "♙", "학생 조회"],
    ["seats", "▤", "좌석 확인"],
    ["warnings", "▣", "경고카드"],
    ["records", "◷", "출결 조회"],
    ["notices", "♧", "공지사항"],
    ["suggestions", "✉", "건의사항 조회"],
    ["stats", "▥", "이용 통계"],
  ],
  student: [
    ["home", "▦", "내 자습실"],
    ["attendance", "✓", "내 교시별 출결"],
    ["ranking", "♛", "내 순위"],
    ["cleaning", "♧", "청소 당번표"],
    ["seats", "▤", "좌석 확인"],
    ["warnings", "▣", "경고카드"],
    ["records", "◷", "나의 출결"],
    ["notices", "♧", "공지사항"],
    ["suggestions", "✉", "건의사항"],
    ["stats", "▥", "이용 통계"],
  ],
};
export function orderedMenu(role: MenuRole, orders: MenuOrders): MenuItem[] {
  const base = defaultMenus[role],
    keys = Array.isArray(orders?.[role]) ? orders[role]! : [];
  return [...new Set([...keys, ...base.map((m) => m[0])])].flatMap((key) => {
    const item = base.find((m) => m[0] === key);
    return item ? [item] : [];
  });
}
export function cachedMenuOrders(mode: string): MenuOrders {
  try {
    return JSON.parse(localStorage.getItem(`sh-menu-order-${mode}`) || "{}");
  } catch {
    return {};
  }
}
export function cacheMenuOrders(mode: string, orders: MenuOrders) {
  try {
    localStorage.setItem(`sh-menu-order-${mode}`, JSON.stringify(orders));
  } catch {}
}
