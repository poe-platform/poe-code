import path from "node:path";
import { UserError } from "toolcraft";

export interface OpenApiLock {
  specSha: string;
}

interface OpenApiLockDocument extends OpenApiLock {
  version: 1;
}

export interface LockFileSystem {
  mkdir(directoryPath: string, options?: { recursive?: boolean }): Promise<unknown>;
  readFile(filePath: string, encoding: BufferEncoding): Promise<string>;
  writeFile(filePath: string, contents: string, encoding: BufferEncoding): Promise<void>;
}

export function parseOpenApiLock(contents: string, lockPath: string): OpenApiLock | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new UserError(`Lock file "${lockPath}" is not valid JSON: ${getErrorMessage(error)}.`, {
      cause: error
    });
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== 1 ||
    typeof (parsed as { specSha?: unknown }).specSha !== "string" ||
    (parsed as { specSha: string }).specSha.length === 0
  ) {
    return null;
  }

  return {
    specSha: (parsed as { specSha: string }).specSha
  };
}

export function stringifyOpenApiLock(lock: OpenApiLock): string {
  const document: OpenApiLockDocument = {
    version: 1,
    specSha: lock.specSha
  };

  return `${JSON.stringify(document, null, 2)}\n`;
}

export async function readOpenApiLock(
  fs: Pick<LockFileSystem, "readFile">,
  lockPath: string
): Promise<OpenApiLock | null> {
  try {
    return parseOpenApiLock(await fs.readFile(lockPath, "utf8"), lockPath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

export async function writeOpenApiLock(
  fs: LockFileSystem,
  lockPath: string,
  lock: OpenApiLock
): Promise<void> {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  try {
    await fs.writeFile(lockPath, stringifyOpenApiLock(lock), "utf8");
  } catch (error) {
    const code = getErrorCode(error);
    throw new UserError(
      `Failed to write lock file "${lockPath}"${code === undefined ? "" : ` (${code})`}: ${getErrorMessage(error)}`,
      { cause: error }
    );
  }
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as NodeJS.ErrnoException).code === "string"
  ) {
    return (error as NodeJS.ErrnoException).code;
  }

  return undefined;
}
