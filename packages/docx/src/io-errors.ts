export interface PublishedFile { readonly path: string; readonly bytes: number }

export class PublicationError extends Error {
  /** Secondary owned-resource cleanup failure; never replaces the primary cause. */
  cleanupError?: unknown;
  constructor(
    readonly code: "conflict" | "permission" | "unsupported-publication" | "sink-failure",
    message: string,
    readonly published: readonly PublishedFile[] = [],
    readonly stdoutMayBePartial = false,
    options?: ErrorOptions
  ) { super(message, options); }
}

/** Denied capability I/O, retaining publication receipts when output was involved. */
export class PermissionError extends PublicationError {
  override readonly name = "PermissionError";
  override readonly code = "permission";
  constructor(message = "Document access denied.", options?: ErrorOptions, published: readonly PublishedFile[] = [], stdoutMayBePartial = false) {
    super("permission", message, published, stdoutMayBePartial, options);
  }
}

/** Classify explicit adapter denials without relabeling ordinary I/O failures. */
export function asPermissionError(error: unknown): PermissionError | undefined {
  if (error instanceof PermissionError) return error;
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code !== "EACCES" && code !== "EPERM" && code !== "EROFS" && code !== "permission") return undefined;
  const publication = error instanceof PublicationError ? error : undefined;
  const result = new PermissionError("Document access denied.", { cause: publication?.cause ?? error }, publication?.published, publication?.stdoutMayBePartial);
  if (publication?.cleanupError !== undefined) result.cleanupError = publication.cleanupError;
  return result;
}
