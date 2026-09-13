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
  | "unsafe-path"
  | "missing-binding";

export class OfficeError extends Error {
  override readonly name = "OfficeError";

  constructor(
    readonly code: OfficeErrorCode,
    message: string,
    readonly phase: Phase
  ) {
    super(message);
  }
}
