export function validateSheetEndpoint(value: unknown): string {
  const url = String(value || "").trim();
  if (
    !/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(
      url,
    )
  )
    throw Error("올바른 Apps Script 웹앱 배포 주소를 입력하세요.");
  return url;
}
export function seatSheetRows(
  seats: { id: number; enabled: boolean }[],
  students: { name: string; number: string; seat_id: number | null }[],
) {
  if (
    seats.length !== 72 ||
    new Set(seats.map((s) => s.id)).size !== 72 ||
    seats.some((s) => !Number.isInteger(s.id) || s.id < 1 || s.id > 72)
  )
    throw Error("구글 좌석표는 1~72번 좌석 구성을 사용합니다.");
  const used = new Set<number>();
  for (const s of students) {
    if (s.seat_id === null) continue;
    if (
      used.has(s.seat_id) ||
      !seats.some((seat) => seat.id === s.seat_id && seat.enabled)
    )
      throw Error("저장된 좌석 배정을 확인하세요.");
    used.add(s.seat_id);
  }
  return [...seats]
    .sort((a, b) => a.id - b.id)
    .map((seat) => {
      const s = students.find((s) => s.seat_id === seat.id);
      return { id: seat.id, number: s?.number || "", name: s?.name || "" };
    });
}
export async function callSeatSheet(
  endpoint: string,
  secret: string,
  action: "check" | "sync" | "roster" | "attendance",
  spreadsheetId: string,
  seats?: { id: number; number: string; name: string }[],
  attendance?: {
    day: string;
    generation: number;
    rows: { number: string; name: string; statuses: string[]; note: string }[];
  },
) {
  validateSheetEndpoint(endpoint);
  const requestId = crypto.randomUUID();
  const payload = JSON.stringify({
    action,
    issuedAt: Date.now(),
    requestId,
    spreadsheetId,
    ...(action === "sync" ? { seats } : {}),
    ...(action === "attendance" ? { attendance } : {}),
  });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = Array.from(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload, signature }),
      redirect: "follow",
      signal: AbortSignal.timeout(60000),
    });
  } catch {
    throw Error(
      "구글 연결이 지연되거나 실패했습니다. 시트 상태를 확인한 뒤 다시 시도하세요.",
    );
  }
  let result: {
    ok: boolean;
    ready?: boolean;
    updated?: number;
    error?: string;
    before?: unknown;
    students?: { number: string; name: string }[];
    attendance?: boolean;
    url?: string;
  };
  try {
    result = await response.json();
  } catch {
    throw Error(
      "Apps Script 배포 설정을 확인하세요. 실행 계정은 나, 액세스는 모든 사용자여야 합니다.",
    );
  }
  if (!response.ok || !result.ok)
    throw Error(result.error || "구글 시트 연결 실패");
  if (
    action === "check"
      ? result.ready !== true
      : action === "sync"
        ? result.updated !== 72
        : action === "roster"
          ? !Array.isArray(result.students)
          : typeof result.updated !== "number"
  )
    throw Error("구글 시트 응답을 확인하세요.");
  return { ...result, requestId };
}
