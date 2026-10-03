import { readBytes } from "@poe-code/safe-fs/contracts";
import { dictGet, type PdfCosDict, type PdfXRefEntry } from "../ast.js";
import { PdfError } from "../errors.js";
import type { PdfFileSource } from "../source.js";
import { CosRangeLexer } from "./lexer.js";
import { parseCosRangeObject, parseCosRangeValue, type ParseCosRangeOptions, type PdfRangeObject } from "./range-parser.js";

export interface ReadCosXrefOptions extends ParseCosRangeOptions {
  /** Maximum rows in this revision, including free entries. */
  readonly maxEntries?: number;
  readonly maxDecodedBytes?: number;
  /** Decode filtered payloads without collecting them. The reader supplies the
   * retained raw range; the callback owns and cleans up its codec state. */
  readonly decodeStream?: (object: PdfRangeObject, input: AsyncIterable<Uint8Array>, signal?: AbortSignal) => AsyncIterable<Uint8Array>;
}

function budget(value: number | undefined, name: string): number {
  if (value === undefined || value === Infinity) return Infinity;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid ${name}`);
  return value;
}
function range(start: number, count: number): void {
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(start + count)) {
    throw new PdfError("E_PARSE", "Invalid XRef range fields");
  }
}

class DecodedFields {
  private readonly iterator: AsyncGenerator<Uint8Array>;
  private bytes: Uint8Array = new Uint8Array(0);
  private position = 0;
  private total = 0;
  constructor(input: AsyncIterable<Uint8Array>, private readonly maximum: number, private readonly signal: AbortSignal | undefined) {
    this.iterator = readBytes(input, signal);
  }
  private async available(): Promise<boolean> {
    this.signal?.throwIfAborted();
    while (this.position === this.bytes.length) {
      const step = await this.iterator.next();
      this.signal?.throwIfAborted();
      if (step.done) return false;
      if (step.value.length > Math.min(this.maximum, Number.MAX_SAFE_INTEGER) - this.total) throw new PdfError("E_LIMIT", "PDF xref decoded byte limit exceeded");
      this.total += step.value.length;
      this.bytes = step.value;
      this.position = 0;
    }
    return true;
  }
  async integer(width: number): Promise<number> {
    let value = 0;
    while (width > 0) {
      if (!await this.available()) throw new PdfError("E_PARSE", "Truncated XRef stream");
      const count = Math.min(width, this.bytes.length - this.position);
      for (let i = 0; i < count; i++) {
        value = value * 256 + this.bytes[this.position++]!;
        if (!Number.isSafeInteger(value)) throw new PdfError("E_PARSE", "Invalid XRef field value");
      }
      width -= count;
    }
    return value;
  }
  async finish(): Promise<void> {
    // Finish the codec even when the payload contains bytes beyond the records,
    // preserving checksum failures and budgets that apply to all decoded bytes.
    this.position = this.bytes.length;
    while (await this.available()) this.position = this.bytes.length;
  }
  async close(): Promise<void> {
    this.bytes = new Uint8Array(0);
    this.position = 0;
    await this.iterator.return(undefined);
  }
}

/** Pull a revision's entries without a document-sized Map. The generator's final
 * value is its trailer dictionary. Stopping iteration leaves the source open and
 * closes an active decoder. Revisions and object bodies are not eagerly loaded. */
export async function* readCosXrefRevision(source: PdfFileSource, offset: number, options: ReadCosXrefOptions = {}): AsyncGenerator<PdfXRefEntry, PdfCosDict, void> {
  const maximum = budget(options.maxEntries, "maxEntries");
  const maxDecoded = budget(options.maxDecodedBytes, "maxDecodedBytes");
  const { signal } = options;
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= source.size) throw new PdfError("E_PARSE", `Invalid xref offset: ${offset}`);
  const lexer = new CosRangeLexer(source, { start: offset, ...(signal ? { signal } : {}), ...(options.maxTokenBytes === undefined ? {} : { maxTokenBytes: options.maxTokenBytes }) });
  const first = await lexer.nextToken();
  let admitted = 0;
  const admit = (count: number) => {
    if (count > Math.min(maximum, Number.MAX_SAFE_INTEGER) - admitted) throw new PdfError("E_LIMIT", "PDF xref entry limit exceeded");
    admitted += count;
  };
  let turns = 0;
  if (first?.kind === "keyword" && first.value === "xref") {
    while (true) {
      signal?.throwIfAborted();
      const saved = lexer.offset;
      const start = await lexer.nextToken();
      if (!start) throw new PdfError("E_PARSE", "Unexpected EOF in xref table");
      if (start.kind === "keyword" && start.value === "trailer") break;
      if (start.kind !== "number") { lexer.offset = saved; break; }
      const count = await lexer.nextToken();
      if (count?.kind !== "number") throw new PdfError("E_PARSE", "Malformed xref subsection header");
      range(start.value, count.value);
      admit(count.value);
      for (let i = 0; i < count.value; i++) {
        const position = await lexer.nextToken();
        const generation = await lexer.nextToken();
        const flag = await lexer.nextToken();
        if (position?.kind !== "number" || generation?.kind !== "number" || flag?.kind !== "keyword" ||
            !Number.isSafeInteger(position.value) || position.value < 0 || !Number.isSafeInteger(generation.value) || generation.value < 0) {
          throw new PdfError("E_PARSE", "Malformed xref entry row");
        }
        signal?.throwIfAborted();
        yield flag.value === "n"
          ? { type: "uncompressed", objectNumber: start.value + i, offset: position.value, generationNumber: generation.value }
          : { type: "free", objectNumber: start.value + i, nextFreeObjectNumber: position.value, generationNumber: generation.value };
        if (++turns % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }
    const { value } = await parseCosRangeValue(source, lexer.offset, options);
    if (value?.kind !== "dict") throw new PdfError("E_PARSE", "Missing trailer dictionary after xref table");
    return value;
  }

  const object = await parseCosRangeObject(source, offset, options);
  if (!object.stream || object.value.kind !== "dict") throw new PdfError("E_PARSE", `Expected xref table or XRef stream at offset ${offset}`);
  const dict = object.value;
  const widths = dictGet(dict, "W");
  const size = dictGet(dict, "Size");
  if (widths?.kind !== "array" || widths.items.length !== 3 || !widths.items.every(node => node.kind === "number" && Number.isSafeInteger(node.value) && node.value >= 0)) {
    throw new PdfError("E_PARSE", "Invalid XRef entry fields length");
  }
  const [w0, w1, w2] = widths.items.map(node => node.kind === "number" ? node.value : 0) as [number, number, number];
  if (!Number.isSafeInteger(w0 + w1 + w2) || w0 + w1 + w2 === 0) throw new PdfError("E_PARSE", "Invalid XRef entry fields length");
  if (size?.kind !== "number" || !Number.isSafeInteger(size.value) || size.value < 0) throw new PdfError("E_PARSE", "Invalid XRef stream Size");
  const index = dictGet(dict, "Index");
  if (index && (index.kind !== "array" || index.items.length % 2 !== 0)) throw new PdfError("E_PARSE", "Invalid XRef range fields");
  function* subsections(): Generator<readonly [number, number]> {
    if (!index) { yield [0, size!.kind === "number" ? size!.value : 0]; return; }
    if (index.kind !== "array") return;
    for (let i = 0; i < index.items.length; i += 2) {
      const start = index.items[i];
      const count = index.items[i + 1];
      if (start?.kind !== "number" || count?.kind !== "number") throw new PdfError("E_PARSE", "Invalid XRef range fields");
      yield [start.value, count.value];
    }
  }
  // Validate all ranges before invoking a decoder or allocating record state.
  for (const [start, count] of subsections()) { range(start, count); admit(count); }
  if (admitted > Math.floor(Math.min(maxDecoded, Number.MAX_SAFE_INTEGER) / (w0 + w1 + w2))) {
    throw new PdfError("E_LIMIT", "PDF xref decoded byte limit exceeded");
  }
  const raw = source.stream(object.stream.start, object.stream.end - object.stream.start, signal);
  const filter = dictGet(dict, "Filter") ?? dictGet(dict, "F");
  if (!options.decodeStream && (filter?.kind === "name" || (filter?.kind === "array" && filter.items.length > 0))) {
    throw new PdfError("E_CAPABILITY", "Filtered XRef streams require a streaming decoder");
  }
  const reader = new DecodedFields(options.decodeStream ? options.decodeStream(object, raw, signal) : raw, maxDecoded, signal);
  let failed = false;
  try {
    for (const [start, count] of subsections()) {
      for (let i = 0; i < count; i++) {
        const type = w0 ? await reader.integer(w0) : 1;
        const field1 = await reader.integer(w1);
        const field2 = w2 ? await reader.integer(w2) : 0;
        signal?.throwIfAborted();
        if (type === 0) yield { type: "free", objectNumber: start + i, nextFreeObjectNumber: field1, generationNumber: field2 };
        else if (type === 1) yield { type: "uncompressed", objectNumber: start + i, offset: field1, generationNumber: field2 };
        else if (type === 2) yield { type: "compressed", objectNumber: start + i, objectStreamNumber: field1, indexInStream: field2 };
        else throw new PdfError("E_PARSE", `Invalid XRef entry type: ${type}`);
        if (++turns % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    }
    await reader.finish();
    signal?.throwIfAborted();
    return dict;
  } catch (error) { failed = true; throw error; }
  finally { await reader.close().catch(error => { if (!failed) throw error; }); }
}
