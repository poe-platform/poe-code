import { FsError } from "./contracts/errors.js";
import { CommandArgumentIdentityError, type InternalErrorHandler } from "./contracts/command.js";

export class PublicDiagnostic extends Error {}

export function publicDiagnosticMessage(error: unknown, onInternalError?: InternalErrorHandler): string {
  if (error instanceof FsError || error instanceof CommandArgumentIdentityError) return error.message;
  if (error instanceof PublicDiagnostic && !Object.hasOwn(error, "cause")) return error.message;
  const original: unknown = error instanceof PublicDiagnostic ? error.cause : error;
  const detail = error instanceof PublicDiagnostic ? error.message : "internal error";
  try {
    const pending = onInternalError?.(original);
    if (pending !== undefined) void Promise.resolve(pending).catch(() => undefined);
  } catch { return detail; }
  return detail;
}
