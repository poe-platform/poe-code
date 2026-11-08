import { cfbLayout } from "./cfb-write-source.js";
import { SsconvertError, type CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";

export class BiffOutput {
  private readonly parts: Uint8Array[] = [];
  length = 0;
  constructor(readonly context: CapabilityContext, readonly maximumRecord: number) {}
  record(opcode: number, payload: Uint8Array = new Uint8Array()): number {
    this.context.signal.throwIfAborted();
    if (payload.length > this.maximumRecord) throw new SsconvertError("unsupported-feature", "Excel BIFF record is too large");
    if (payload.length + 4 > this.context.limits.outputBytes - this.length)
      throw new SsconvertError("resource-limit", "ssconvert BIFF output bytes limit exceeded");
    if (this.parts.length >= (this.context.limits.workbookNodes ?? this.context.limits.outputBytes / 4))
      throw new SsconvertError("resource-limit", "ssconvert BIFF record limit exceeded");
    const at = this.length, bytes = new Uint8Array(payload.length + 4), view = new DataView(bytes.buffer);
    view.setUint16(0, opcode, true); view.setUint16(2, payload.length, true); bytes.set(payload, 4);
    this.parts.push(bytes); this.length += bytes.length; return at;
  }
  /** Keep tokens/elements intact; oversized UTF-16 array strings carry width flags. */
  continuedRecord(opcode: number, payload: Uint8Array, boundaries?: readonly number[],
    strings: readonly { start: number; end: number }[] = []): number {
    const at = this.length;
    for (const [code, part] of biffContinuedParts(opcode, payload, this.maximumRecord, boundaries, strings)) this.record(code, part);
    return at;
  }
  finish(): Uint8Array {
    this.context.signal.throwIfAborted();
    const bytes = new Uint8Array(this.length); let at = 0;
    for (const part of this.parts) { bytes.set(part, at); at += part.length; }
    return bytes;
  }
}

export function words(...values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 2), view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint16(index * 2, value, true)); return bytes;
}

/** MS-CFB 2.4: small streams share 64-byte mini sectors; directory sizes exclude
 * allocation padding so consumers see exactly the BIFF record stream. */
export function writeCfb(streams: ReadonlyMap<string, Uint8Array>, context: CapabilityContext): Uint8Array {
  const layout = cfbLayout(new Map([...streams].map(([name, bytes]) => [name, bytes.length])), context);
  const bytes = new Uint8Array(layout.length); let at = 0;
  for (const part of layout.parts) {
    context.signal.throwIfAborted();
    for (const copy of part.copies) part.bytes.set(streams.get(copy.name)!.subarray(copy.offset, copy.offset + copy.length), copy.target);
    bytes.set(part.bytes, at); at += part.bytes.length;
  }
  return bytes;
}

export function* biffContinuedParts(opcode: number, payload: Uint8Array, maximumRecord: number,
  boundaries?: readonly number[], strings: readonly { start: number; end: number }[] = []): Generator<readonly [number, Uint8Array]> {
  let offset = 0, next = 0, stringIndex = 0;
  do {
    while (strings[stringIndex] && strings[stringIndex]!.end <= offset) stringIndex++;
    const continuedString = strings[stringIndex] && strings[stringIndex]!.start < offset;
    const prefix = continuedString ? 1 : 0;
    const maximum = Math.min(payload.length, offset + maximumRecord - prefix);
    let end = maximum;
    if (boundaries && maximum < payload.length) {
      end = offset;
      while (next < boundaries.length && boundaries[next]! <= maximum) end = boundaries[next++]!;
      let candidate = stringIndex;
      while (strings[candidate] && strings[candidate]!.end <= maximum) candidate++;
      const string = strings[candidate];
      if (string && string.end - string.start + 4 > maximumRecord &&
        string.start < maximum && maximum < string.end) {
        const characterEnd = maximum - (maximum - string.start) % 2;
        if (characterEnd > string.start) end = Math.max(end, characterEnd);
      }
      if (end <= offset) throw new SsconvertError("unsupported-feature", "Excel BIFF formula token is too large");
    }
    let part = payload.subarray(offset, end);
    if (prefix) {
      const continued = new Uint8Array(part.length + 1); continued[0] = 1;
      continued.set(part, 1); part = continued;
    }
    yield [offset === 0 ? opcode : 0x3c, part];
    offset = end;
  } while (offset < payload.length);
}
