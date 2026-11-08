import type { RunHandle } from "@poe-code/process-runner";

export const RUN_HANDLE_TERMINATION_GRACE_MS = 1_000;

export interface RunHandleTerminationResult {
  escalated: boolean;
  exited: boolean;
}

export async function terminateRunHandle(
  handle: RunHandle,
  graceMs = RUN_HANDLE_TERMINATION_GRACE_MS
): Promise<RunHandleTerminationResult> {
  killQuietly(handle, "SIGTERM");
  if (await waitForRunHandle(handle, graceMs)) {
    return { escalated: false, exited: true };
  }

  killQuietly(handle, "SIGKILL");
  return {
    escalated: true,
    exited: await waitForRunHandle(handle, graceMs)
  };
}

function killQuietly(handle: RunHandle, signal: NodeJS.Signals): void {
  try {
    handle.kill(signal);
  } catch {
    // Best effort: callers still continue through the bounded wait/escalation path.
  }
}

function waitForRunHandle(handle: RunHandle, timeoutMs: number): Promise<boolean> {
  let timeout: NodeJS.Timeout | null = null;

  return Promise.race([
    handle.result.then(
      () => true,
      () => true
    ),
    new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => {
        resolve(false);
      }, timeoutMs);
    })
  ]).finally(() => {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
  });
}
