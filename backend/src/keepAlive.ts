const PING_INTERVAL_MS = 10 * 60 * 1000;

export function startKeepAlive(selfUrl: string): void {
  setInterval(() => {
    fetch(`${selfUrl}/health`).catch(() => {
      // ignore transient failures; the next interval tries again
    });
  }, PING_INTERVAL_MS);
}
