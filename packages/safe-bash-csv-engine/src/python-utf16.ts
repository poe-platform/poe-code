import { PythonTextDecodeError } from "./python-codepages.js";

export class PythonTextEncodingError extends Error {}

/** CSVkit's strict native UTF16 codec with a bounded incremental BOM prefix. */
export class PythonUtf16Decoder {
  private decoder: TextDecoder | undefined;
  private readonly prefix = new Uint8Array(2);
  private used = 0;
  private missingSignature = false;
  constructor(encoding: "utf-16" | "utf-16-le" | "utf-16-be") {
    if (encoding !== "utf-16") this.decoder = new TextDecoder(encoding === "utf-16-be" ? "utf-16be" : "utf-16le", { fatal: true, ignoreBOM: true });
  }
  decode(bytes: Uint8Array = new Uint8Array(), options?: { stream?: boolean }): string {
    let offset = 0, text = "";
    try {
      if (!this.decoder) {
        while (this.used < 2 && offset < bytes.length) this.prefix[this.used++] = bytes[offset++]!;
        if (this.used < 2) {
          if (this.used && !options?.stream) throw new PythonTextDecodeError("Truncated UTF-16 input");
          return "";
        }
        const little = this.prefix[0] === 0xff && this.prefix[1] === 0xfe;
        const big = this.prefix[0] === 0xfe && this.prefix[1] === 0xff;
        this.missingSignature = !little && !big;
        this.decoder = new TextDecoder(big ? "utf-16be" : "utf-16le", { fatal: true, ignoreBOM: true });
        if (this.missingSignature) text = this.decoder.decode(this.prefix, { stream: true });
      }
      text += this.decoder.decode(bytes.subarray(offset), options);
    } catch { throw new PythonTextDecodeError("Invalid UTF-16 input"); }
    // CPython performs strict decoding before checking consumed input for a BOM.
    // An unfinished surrogate has not yet consumed a character.
    if (this.missingSignature && text.length) throw new PythonTextEncodingError("UTF-16 stream does not start with BOM");
    return text;
  }
}
