export type OfficePhase =
  | "usage"
  | "admit"
  | "parse"
  | "index"
  | "select"
  | "validate-intent"
  | "mutate"
  | "validate-result"
  | "serialize"
  | "publish";

export type ByteErrorCode =
  | "invalid-type"
  | "invalid-value"
  | "resource-limit"
  | "cancelled"
  | "io-failure";

export type OfficeErrorCode =
  | ByteErrorCode
  | "invalid-archive"
  | "invalid-opc"
  | "invalid-xml"
  | "unsupported-profile"
  | "unsupported-edit"
  | "unsafe-path"
  | "missing-binding"
  | "dangling-reference"
  | "invalid-selection"
  | "index-out-of-range"
  | "missing-key"
  | "property-unavailable"
  | "invalid-handle"
  | "missing-selection"
  | "ambiguous-selection"
  | "stale-selection";

export class OfficeError extends Error {
  override readonly name: string = "OfficeError";

  constructor(
    readonly code: OfficeErrorCode,
    message: string,
    readonly phase: OfficePhase
  ) {
    super(message);
  }
}

