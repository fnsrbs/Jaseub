export const defaultFarewellCopy = {
  farewell_enabled: "true",
  farewell_date: "2026-11-17",
  farewell_eyebrow: "온실에서 보내는 마지막 편지",
  farewell_title: "쌓아온 시간,\n빛날 너의 내일",
  farewell_body:
    "여기 기록된 시간은\n네가 해온 노력의 일부일 뿐이야.\n\n초등학교에 입학한 날부터 지금까지,\n교실에서, 집에서, 혼자 책상 앞에서\n보낸 12년의 시간은\n숫자 하나에 다 담을 수 없으니까.\n\n잘해낸 날도, 마음처럼 되지 않았던 날도\n너는 배우고 자라며 여기까지 왔어.\n\n시험 날에는 쌓아온 너의 힘을 믿고,\n한 문제씩 차분하게 풀고 와.\n\n하루하루 모은 클로버가\n시험 날에는 행운으로 돌아오길.",
  farewell_wish: "너의 합격을 진심으로 응원해.",
  farewell_medal_label: "온실 완주 트로피",
  farewell_medal_title: "끝까지 걸어온 너에게",
  farewell_medal_body: "오랜 시간 애써온 너에게 이 트로피를 보냅니다.",
  farewell_signature: "너의 다음 계절도 응원하며, 온실",
};
export type FarewellCopy = typeof defaultFarewellCopy;

export function readFarewellCopy(value?: Record<string, string>): FarewellCopy {
  return Object.fromEntries(
    Object.entries(defaultFarewellCopy).map(([key, fallback]) => [
      key,
      typeof value?.[key] === "string" ? value[key] : fallback,
    ]),
  ) as FarewellCopy;
}

export function validateFarewellCopy(value: FarewellCopy) {
  const day = value.farewell_date;
  const stamp = Date.parse(`${day}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(stamp) ||
    new Date(stamp).toISOString().slice(0, 10) !== day
  )
    throw Error("표시 날짜를 확인하세요.");
  if (!["true", "false"].includes(value.farewell_enabled))
    throw Error("편지 표시 여부를 확인하세요.");
  if (
    Object.values(value).some(
      (text) => typeof text !== "string" || text.length > 2000,
    )
  )
    throw Error("각 문구는 2000자 이내로 입력하세요.");
  if (!value.farewell_title.trim() || !value.farewell_medal_title.trim())
    throw Error("편지 제목과 트로피 이름을 입력하세요.");
  return value;
}
