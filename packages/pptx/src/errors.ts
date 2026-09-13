import type { Phase } from "./contracts.js";

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
  | "invalid-handle"
  | "missing-selection"
  | "ambiguous-selection"
  | "stale-selection";

export class OfficeError extends Error {
  override readonly name: string = "OfficeError";

  constructor(
    readonly code: OfficeErrorCode,
    message: string,
    readonly phase: Phase
  ) {
    super(message);
  }
}

export class InvalidHandleError extends OfficeError {
  override readonly name = "InvalidHandleError";
  constructor() {
    super("invalid-handle", "Model handle was invalidated.", "select");
  }
}
