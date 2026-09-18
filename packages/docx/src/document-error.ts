/** Base category for malformed or unsupported document data. */
export class DocumentError extends Error {
  readonly code: string = "invalid-package";
}
