import { randomUUID } from "node:crypto";
import path from "node:path";
import { UserError } from "@poe-code/user-error";
import { hasOwnErrorCode } from "../error-codes.js";
import { assertNotAborted, createAbortError } from "../utils.js";
import type { PipelineFileSystem } from "../types.js";

const LOCK_WAIT_MS = 30_000;
const LOCK_RETRY_MS = 10;

export async function withPlanLock<Result>(options: {
  fs: Pick<PipelineFileSystem, "readFile" | "writeFile" | "unlink">;
  planPath: string;
  lockPath?: string;
  kind: "run" | "status";
  signal?: AbortSignal;
  operation: () => Promise<Result>;
}): Promise<Result> {
  const absolutePath = path.resolve(options.planPath);
  const lockPath = options.lockPath ?? path.join(path.dirname(absolutePath), `.${path.basename(absolutePath)}.pipeline-${options.kind}.lock`);
  const owner = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    assertNotAborted(options.signal);
    try {
      await options.fs.writeFile(lockPath, owner, { encoding: "utf8", flag: "wx" });
      break;
    } catch (error) {
      if (!hasOwnErrorCode(error, "EEXIST")) throw error;
      if (Date.now() >= deadline) {
        throw new UserError(
          `Timed out waiting for pipeline ${options.kind} lock: ${absolutePath}. ` +
          `Another pipeline operation may still be active. Remove ${lockPath} only after confirming all operations using this plan have stopped.`
        );
      }
      await waitForRetry(options.signal);
    }
  }

  let outcome: { result: Result } | { error: unknown };
  try {
    assertNotAborted(options.signal);
    outcome = { result: await options.operation() };
  } catch (error) {
    outcome = { error };
  }
  try {
    if (await options.fs.readFile(lockPath, "utf8") !== owner) {
      throw new UserError(`Pipeline lock ownership changed before release: ${lockPath}`);
    }
    await options.fs.unlink(lockPath);
  } catch (releaseError) {
    if ("error" in outcome) {
      throw new AggregateError([outcome.error, releaseError], "Pipeline operation and lock release failed");
    }
    throw releaseError;
  }
  if ("error" in outcome) throw outcome.error;
  return outcome.result;
}

async function waitForRetry(signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, LOCK_RETRY_MS);
    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(createAbortError());
    }
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
