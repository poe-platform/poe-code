import { FsError } from "../contracts/index.js";
import { bufferLimit } from "./internal.js";

/** Invocation-wide admission for owned sort records, not a host-memory estimate. */
export class SortRecordBudget {
  #records = 0;
  #bytes = 0;

  admit(byteLength: number): void {
    const bytes = byteLength + 1;
    if (this.#records >= 100_000 || bytes > bufferLimit - this.#bytes) {
      throw new FsError("EFBIG", { message: "sort buffer limit exceeded" });
    }
    this.#records++;
    this.#bytes += bytes;
  }
}
