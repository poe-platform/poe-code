/** Base category for malformed or unsupported document data. */
export class DocumentError extends Error {
  readonly code: string = "invalid-package";
}

/** A stored document value violates its declared semantic type. */
export class InvalidDocumentError extends DocumentError {
  override readonly code = "invalid-document";
}
