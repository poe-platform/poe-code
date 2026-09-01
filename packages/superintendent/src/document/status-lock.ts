import path from "node:path";
import { UserError } from "toolcraft";
import { hasOwnErrorCode } from "../error-codes.js";

const STATUS_LOCK_TIMEOUT_MS = 5_000;
const STATUS_LOCK_RETRY_MS = 10;

type StatusLockFs = {
  writeFile(
    path: string,
    content: string,
    options?: { encoding?: BufferEncoding; flag?: string }
  ): Promise<void>;
  unlink?(path: string): Promise<void>;
  mkdir?(path: string): Promise<void>;
  rmdir?(path: string): Promise<void>;
};

export async function withDocumentStatusLock<T>(
  docPath: string,
  fs: StatusLockFs,
  operation: () => Promise<T>
): Promise<T> {
  const lockPath = path.join(path.dirname(docPath), `.${path.basename(docPath)}.status.lock`);
  const directoryLock = fs.mkdir !== undefined && fs.rmdir !== undefined;
  if (!directoryLock && !fs.unlink) {
    throw new UserError("Superintendent status updates require filesystem lock cleanup support.");
  }
  const deadline = Date.now() + STATUS_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      if (directoryLock) await fs.mkdir!(lockPath);
      else await fs.writeFile(lockPath, "", { flag: "wx", encoding: "utf8" });
      break;
    } catch (error) {
      if (!hasOwnErrorCode(error, "EEXIST") && !hasOwnErrorCode(error, "EISDIR")) throw error;
      if (Date.now() >= deadline) {
        throw new UserError(
          `Timed out waiting to update superintendent status: ${docPath}. If no loop or completion process is running, remove ${lockPath} and retry.`
        );
      }
      await new Promise<void>((resolve) => setTimeout(resolve, STATUS_LOCK_RETRY_MS));
    }
  }

  let outcome: { value: T } | { error: unknown };
  try {
    outcome = { value: await operation() };
  } catch (error) {
    outcome = { error };
  }
  try {
    if (directoryLock) await fs.rmdir!(lockPath);
    else await fs.unlink!(lockPath);
  } catch (error) {
    if ("error" in outcome)
      throw new AggregateError(
        [outcome.error, error],
        "Superintendent status update and lock release failed"
      );
    throw error;
  }
  if ("error" in outcome) throw outcome.error;
  return outcome.value;
}
