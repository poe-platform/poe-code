import { OfficeError } from "@poe-code/office-xml";
export { OfficeError, type ByteErrorCode, type OfficeErrorCode } from "@poe-code/office-xml";

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
