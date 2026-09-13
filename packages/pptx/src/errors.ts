import type { Phase } from "./contracts.js";

export type ByteErrorCode =
  | "invalid-type"
  | "invalid-value"
  | "resource-limit"
  | "cancelled"
  | "io-failure";

export class OfficeError extends Error {
  override readonly name = "OfficeError";

  constructor(
    readonly code: ByteErrorCode,
    message: string,
    readonly phase: Phase
  ) {
    super(message);
  }
}
