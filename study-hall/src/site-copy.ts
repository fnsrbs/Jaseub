export const defaultSiteCopy = {
  hero_eyebrow: "A SPACE FOR YOUR GROWTH",
  hero_title: "꾸준한 오늘이\n더 큰 내일을 만듭니다.",
  hero_description:
    "입실부터 퇴실까지, 나의 공부 시간을\n차분하게 기록하는 자습실.",
  login_title: "자습실에 들어가기",
  login_greeting: "안녕하세요. 오늘의 집중을 시작해 볼까요?",
  production_badge: "용인고등학교",
  ranking_encouragement:
    "자신의 속도에 맞춰 꾸준히 공부해 주세요.\n\n조급해하지 않고 나아가다 보면, 어느새 목표에 가까워져 있을 거예요.\n\n꾸준히 나아가는 여러분의 모든 걸음을 응원합니다!",
};
export type SiteCopy = typeof defaultSiteCopy;
export function cachedSiteCopy(mode: string): SiteCopy | null {
  try {
    const stored = JSON.parse(
      localStorage.getItem(`sh-public-copy-${mode}`) || "null",
    );
    if (!stored || typeof stored !== "object" || Array.isArray(stored))
      return null;
    const value = { ...defaultSiteCopy, ...stored };
    if (
      !value ||
      Object.keys(defaultSiteCopy).some(
        (key) => typeof value[key] !== "string" || value[key].length > 2000,
      )
    )
      return null;
    return Object.fromEntries(
      Object.keys(defaultSiteCopy).map((key) => [key, value[key]]),
    ) as SiteCopy;
  } catch {
    return null;
  }
}
export function cacheSiteCopy(mode: string, copy: SiteCopy) {
  try {
    localStorage.setItem(`sh-public-copy-${mode}`, JSON.stringify(copy));
  } catch {}
}
