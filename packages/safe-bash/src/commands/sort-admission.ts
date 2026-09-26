import { FsError } from "../contracts/index.js";
import { bufferLimit } from "./internal.js";

/** Invocation-wide admission for owned sort records, not a host-memory estimate. */
export class SortRecordBudget {
  #records = 0;
  #bytes = 0;

  constructor(readonly maxRecords = Infinity, readonly maxBytes = bufferLimit) {}

  canAdmitChunk(chunkLength: number): boolean {
    return this.#records + chunkLength <= this.maxRecords && chunkLength <= this.maxBytes - this.#bytes;
  }

  admit(byteLength: number): void {
    const bytes = byteLength + 1;
    if (this.#records >= this.maxRecords || bytes > this.maxBytes - this.#bytes) {
      throw new FsError("EFBIG", { message: "sort buffer limit exceeded" });
    }
    this.#records++;
    this.#bytes += bytes;
  }
}
