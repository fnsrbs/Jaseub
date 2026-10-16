// Only poll while this page is visible; refresh immediately on returning.
export function pollWhileVisible(
  task: () => void | Promise<void>,
  interval: number,
) {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const run = async () => {
    if (stopped || document.visibilityState !== "visible" || running) return;
    running = true;
    try {
      await task();
    } finally {
      running = false;
    }
  };
  const sync = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
    if (!stopped && document.visibilityState === "visible") {
      void run();
      timer = setInterval(() => void run(), interval);
    }
  };
  document.addEventListener("visibilitychange", sync);
  sync();
  return () => {
    stopped = true;
    if (timer !== undefined) clearInterval(timer);
    document.removeEventListener("visibilitychange", sync);
  };
}
