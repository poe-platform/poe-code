import type { PdfCosArray, PdfCosDict, PdfDictEntry, PdfStoredItems } from "../ast.js";

export interface PdfDictionaryEntryRequest {
  readonly kind: "dictionary-entry";
  readonly entries: PdfStoredItems;
  readonly position: number;
}

/** Pull one entry through a driver's I/O boundary, retaining source order. */
export class PdfDictionaryCursor {
  private index = 0;
  private position: number;
  private readonly length: number;
  constructor(private readonly dict: PdfCosDict) {
    this.length = dict.storedEntries?.length ?? dict.entries.length;
    if (!Number.isSafeInteger(this.length) || this.length < 0) throw new RangeError("Invalid stored dictionary length");
    this.position = dict.storedEntries?.position ?? -1;
  }
  *next(): Generator<PdfDictionaryEntryRequest, IteratorResult<PdfDictEntry, void>, unknown> {
    if (this.index === this.length) {
      if (this.dict.storedEntries && this.position !== -1) throw new Error("Invalid stored dictionary terminator");
      return {done: true, value: undefined};
    }
    let entry = this.dict.entries[this.index];
    if (this.dict.storedEntries) {
      const reply = (yield {kind: "dictionary-entry", entries: this.dict.storedEntries, position: this.position}) as PdfCosArray | undefined;
      if (reply?.kind !== "array" || reply.items[0]?.kind !== "name" || !reply.items[1] || reply.items[2]?.kind !== "number") throw new TypeError("Expected a PDF dictionary record");
      entry = {key: reply.items[0], value: reply.items[1]};
      this.position = reply.items[2].value;
    }
    this.index++;
    return {done: false, value: entry!};
  }
}
