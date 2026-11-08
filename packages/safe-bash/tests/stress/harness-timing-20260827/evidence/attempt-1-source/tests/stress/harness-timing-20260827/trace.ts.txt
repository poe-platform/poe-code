export function trace(event: string, detail: unknown): void {
  if (process.env.HARNESS_TIMING === "1") console.log(`HARNESS_TIMING ${JSON.stringify({ pid: process.pid, event, atMs: performance.now(), detail })}`);
}
