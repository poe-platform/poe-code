import type { PdfCosArray, PdfCosNode, PdfStoredItems } from "../ast.js";

export interface PdfArrayItemRequest {
  readonly kind: "array-item";
  readonly items: PdfStoredItems;
  readonly position: number;
}

export interface PdfArrayCursorState {
  readonly array: PdfCosArray;
  readonly index: number;
  readonly position: number;
}

/** One forward cursor over buffered or caller-backed COS array elements.
 * The driver owns I/O, cancellation and storage lifetime. */
export class PdfArrayCursor {
  private index = 0;
  private position: number;
  private readonly length: number;
  constructor(private readonly array: PdfCosArray, state?: PdfArrayCursorState) {
    this.length = array.storedItems?.length ?? array.items.length;
    if (!Number.isSafeInteger(this.length) || this.length < 0) throw new RangeError("Invalid stored array length");
    this.position = state?.position ?? array.storedItems?.position ?? -1;
    this.index = state?.index ?? 0;
  }
  snapshot(): PdfArrayCursorState { return {array:this.array,index:this.index,position:this.position}; }
  *next(): Generator<PdfArrayItemRequest, IteratorResult<PdfCosNode, void>, unknown> {
    if (this.index === this.length) {
      if (this.array.storedItems && this.position !== -1) throw new Error("Invalid stored array terminator");
      return {done:true,value:undefined};
    }
    let node = this.array.items[this.index];
    if (this.array.storedItems) {
      const reply = (yield {kind:"array-item",items:this.array.storedItems,position:this.position}) as PdfCosNode | undefined;
      if (!reply || typeof reply !== "object" || reply.kind !== "array" || reply.items[0]?.kind !== "number" || !reply.items[1]) throw new TypeError("Expected a PDF array record");
      this.position = reply.items[0].value;
      node = reply.items[1];
    }
    this.index++;
    return {done:false,value:node!};
  }
}
