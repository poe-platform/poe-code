import path from "node:path";
import { assertNotAborted, createAbortError } from "../utils.js";

const pending = new Map<string, Promise<void>>();

export async function serializePlan<Result>(options: {
  planPath: string;
  kind: "run" | "status";
  signal?: AbortSignal;
  onWait?: (planPath: string) => void;
  operation: () => Promise<Result>;
}): Promise<Result> {
  const key = `${options.kind}:${path.resolve(options.planPath)}`;
  let notified = false;
  while (pending.has(key)) {
    assertNotAborted(options.signal);
    if (!notified) { notified = true; options.onWait?.(path.resolve(options.planPath)); }
    assertNotAborted(options.signal);
    const previous = pending.get(key)!;
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(createAbortError());
      options.signal?.addEventListener("abort", abort, { once: true });
      previous.then(resolve).finally(() => options.signal?.removeEventListener("abort", abort));
      if (options.signal?.aborted) abort();
    });
  }
  assertNotAborted(options.signal);
  let release!: () => void;
  pending.set(key, new Promise<void>(resolve => { release = resolve; }));
  try {
    return await options.operation();
  } finally {
    pending.delete(key);
    release();
  }
}
