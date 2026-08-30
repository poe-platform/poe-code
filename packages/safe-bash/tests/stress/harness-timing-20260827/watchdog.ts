import { trace } from "./trace.js";

let sequence = 0;
export async function withHarnessWatchdog<Value>(milliseconds: number, action: (signal: AbortSignal) => Promise<Value>): Promise<Value> {
  const controller = new AbortController();
  const timerId = ++sequence; const armedMs = performance.now(); const dueMs = armedMs + milliseconds;
  trace("semantic-watchdog-armed", { timerId, milliseconds, armedMs, dueMs });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const firedMs = performance.now();
      trace("semantic-watchdog-fired", { timerId, armedMs, dueMs, firedMs, latenessMs: firedMs - dueMs });
      const reason = new Error(`semantic harness watchdog after ${milliseconds}ms`);
      controller.abort(reason);
      reject(reason);
    }, milliseconds);
  });
  try { return await Promise.race([Promise.resolve().then(() => action(controller.signal)), timeout]); }
  finally { clearTimeout(timer); trace("semantic-watchdog-cleared", { timerId }); }
}
