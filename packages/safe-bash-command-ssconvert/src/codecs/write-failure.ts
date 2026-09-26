import { SsconvertError } from "../contracts.js";

/** A native writer can publish bytes and still report an export failure. */
export class CodecWriteFailure extends SsconvertError {
  constructor(readonly bytes: Uint8Array, message: string) {
    super("io", message);
  }
}

export class TextConverterUnavailable extends Error {}
