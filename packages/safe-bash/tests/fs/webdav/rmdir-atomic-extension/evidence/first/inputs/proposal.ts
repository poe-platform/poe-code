export interface ProposedAtomicEmptyDirectoryRequest {
  readonly operation: "atomic-empty-rmdir/v1";
  readonly namespaceUrl: string;
  readonly path: string;
  readonly signal?: AbortSignal;
}

export interface ProposedAtomicEmptyDirectoryResult {
  readonly operation: "atomic-empty-rmdir/v1";
  readonly namespaceUrl: string;
  readonly path: string;
  readonly outcome: "removed";
}

export type ProposedAtomicEmptyDirectoryErrorCode =
  | "ENOTEMPTY" | "ENOTDIR" | "ENOENT" | "EBUSY" | "EACCES" | "EROFS"
  | "ECANCELED" | "ENOTSUP" | "EIO" | "EAGAIN";

export interface ProposedAtomicEmptyDirectoryFailure extends Error {
  readonly code: ProposedAtomicEmptyDirectoryErrorCode;
  readonly cause?: unknown;
}

export interface ProposedAtomicEmptyDirectoryBinding {
  readonly namespaceUrl: string;
  readonly removeEmptyDirectory: (
    request: ProposedAtomicEmptyDirectoryRequest,
  ) => Promise<ProposedAtomicEmptyDirectoryResult>;
}
