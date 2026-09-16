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

export class InvalidXmlError extends OfficeError {
  override readonly name = "InvalidXmlError";
  constructor(message = "Invalid XML or structured edit.") {
    super("invalid-xml", message, "parse");
  }
}

export class PackageNotFoundError extends OfficeError {
  override readonly name = "PackageNotFoundError";
  constructor(message = "Input package was not found.") {
    super("io-failure", message, "admit");
  }
}

export class IndexError extends OfficeError {
  override readonly name = "IndexError";
  constructor(message = "Sequence position is out of range.") {
    super("index-out-of-range", message, "select");
  }
}

export class KeyError extends OfficeError {
  override readonly name = "KeyError";
  constructor(message = "Required collection key is missing.") {
    super("missing-key", message, "select");
  }
}

export class ValueError extends OfficeError {
  override readonly name = "ValueError";
  constructor(message = "Invalid model value.") {
    super("invalid-value", message, "usage");
  }
}

export class TypeError extends OfficeError {
  override readonly name = "TypeError";
  constructor(message = "Invalid model value type.") {
    super("invalid-type", message, "usage");
  }
}

export class PropertyAccessError extends OfficeError {
  override readonly name = "PropertyAccessError";
  constructor(message = "Model property is unavailable.") {
    super("property-unavailable", message, "select");
  }
}
