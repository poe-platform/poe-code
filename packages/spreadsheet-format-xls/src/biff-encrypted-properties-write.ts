import { SsconvertError, type CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import type { ImportedValue, UnsupportedRecord, Workbook } from "@poe-code/spreadsheet-ast";

/** Retained ancillary payloads stay opaque; never reinterpret them as property sets. */
export function appendBiffAncillaryStreams(book: Workbook, streams: Map<string, Uint8Array>,
  handled: Set<UnsupportedRecord>, context: CapabilityContext): void {
  let work = 0, nodes = 0, text = 0, size = 0, closed = false;
  const owned: Uint8Array[] = [];
  const cleanup = () => { closed = true; for (const bytes of owned) bytes.fill(0); };
  context.own(cleanup);
  const charge = (amount: number) => {
    context.signal.throwIfAborted();
    if (closed) throw new SsconvertError("invalid-request", "Encrypted BIFF ancillary writer disposed");
    work += amount;
    if (work > (context.limits.workbookWork ?? context.limits.outputBytes * 8))
      throw new SsconvertError("resource-limit", "ssconvert BIFF ancillary work limit exceeded");
  };
  const names = new Set(["\u0005SUMMARYINFORMATION", "\u0005DOCUMENTSUMMARYINFORMATION"]);
  try {
    for (const [name, bytes] of streams) { charge(1); names.add(name.toUpperCase()); size += bytes.length; }
    for (const record of book.unsupportedRecords ?? []) {
      charge(1);
      if (++nodes > (context.limits.workbookNodes ?? context.limits.outputBytes))
        throw new SsconvertError("resource-limit", "ssconvert BIFF ancillary node limit exceeded");
      if (record.source !== "biff" || record.kind !== "encrypted-ancillary" || record.disposition !== "retained") continue;
      const data = record.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      const object = data as Readonly<Record<string, ImportedValue>>;
      charge(Object.keys(object).length);
      if (Object.keys(object).some(key => !["stream", "bytes"].includes(key)) ||
        typeof object.stream !== "string" || typeof object.bytes !== "string") continue;
      charge(object.stream.length + object.bytes.length);
      text += object.stream.length * 3 + object.bytes.length;
      if (text > (context.limits.workbookTextBytes ?? context.limits.outputBytes * 2))
        throw new SsconvertError("resource-limit", "ssconvert BIFF ancillary text limit exceeded");
      if (names.has(object.stream.toUpperCase()))
        throw new SsconvertError("unsupported-feature", "Ambiguous encrypted BIFF ancillary stream name");
      names.add(object.stream.toUpperCase());
      if (object.bytes.length % 2) throw new SsconvertError("invalid-request", "Invalid retained BIFF ancillary bytes");
      size += object.bytes.length / 2;
      if (size > context.limits.outputBytes || size > 0xffffffff)
        throw new SsconvertError("resource-limit", "ssconvert BIFF ancillary output bytes limit exceeded");
      const bytes = new Uint8Array(object.bytes.length / 2); owned.push(bytes);
      for (let i = 0; i < bytes.length; i++) {
        if (!(i % 1024)) charge(1);
        const high = "0123456789abcdef".indexOf(object.bytes[i * 2]!.toLowerCase());
        const low = "0123456789abcdef".indexOf(object.bytes[i * 2 + 1]!.toLowerCase());
        if (high < 0 || low < 0) throw new SsconvertError("invalid-request", "Invalid retained BIFF ancillary bytes");
        bytes[i] = high * 16 + low;
      }
      streams.set(object.stream, bytes); handled.add(record);
    }
  } catch (error) { cleanup(); throw error; }
}

/** POI CryptoAPIEncryptor.setSummaryEntries / MS-OFFCRYPTO 2.3.5.4.
 * Admit before password acquisition; serialize only while the export key exists.
 * Payload block IDs start at zero. Header and table restart block zero separately. */
export function prepareBiffPropertyContainer(streams: ReadonlyMap<string, Uint8Array>, context: CapabilityContext,
  charge: (amount: number) => void): (keyStream: (block: number, length: number) => Uint8Array) => Uint8Array {
  context.signal.throwIfAborted();
  if (streams.size > 65536 || streams.size > (context.limits.workbookNodes ?? context.limits.outputBytes))
    throw new SsconvertError("resource-limit", "ssconvert encrypted BIFF property node limit exceeded");
  let payloadSize = 0, tableSize = 4, textSize = 0;
  const names = new Set<string>(), entries = [...streams];
  for (const [name, bytes] of entries) {
    charge(1 + name.length);
    if (!name.length || name.length > 31 || [...name].some(character =>
      ["\0", "/", "\\", ":", "!"].includes(character) || character.codePointAt(0)! >= 0xd800 && character.codePointAt(0)! <= 0xdfff) ||
      names.has(name.toUpperCase()))
      throw new SsconvertError("unsupported-feature", "Invalid encrypted BIFF property stream name");
    names.add(name.toUpperCase()); textSize += name.length * 3;
    payloadSize += bytes.length; tableSize += 18 + name.length * 2;
  }
  if (textSize > (context.limits.workbookTextBytes ?? context.limits.outputBytes))
    throw new SsconvertError("resource-limit", "ssconvert encrypted BIFF property text limit exceeded");
  const offset = 8 + payloadSize, size = offset + tableSize;
  if (size > 0xffffffff || size > context.limits.outputBytes)
    throw new SsconvertError("resource-limit", "ssconvert encrypted BIFF property output bytes limit exceeded");
  charge(size * 2 + (entries.length + 2) * 320);
  let closed = false, output: Uint8Array | undefined;
  const cleanup = () => { closed = true; output?.fill(0); };
  context.own(cleanup);
  const check = () => {
    context.signal.throwIfAborted();
    if (closed) throw new SsconvertError("invalid-request", "Encrypted BIFF property writer disposed");
  };
  return keyStream => {
    check(); output = new Uint8Array(size);
    const view = new DataView(output.buffer);
    const encrypt = (at: number, length: number, block: number) => {
      check(); const key = keyStream(block, length);
      try {
        check();
        for (let i = 0; i < length; i++) { if (!(i % 1024)) check(); output![at + i] = output![at + i]! ^ key[i]!; }
      } finally { key.fill(0); }
    };
    try {
      view.setUint32(0, offset, true); view.setUint32(4, tableSize, true);
      view.setUint32(offset, entries.length, true);
      let payload = 8, descriptor = offset + 4, block = 0;
      for (const [name, bytes] of entries) {
        check(); output.set(bytes, payload);
        view.setUint32(descriptor, payload, true); view.setUint32(descriptor + 4, bytes.length, true);
        view.setUint16(descriptor + 8, block, true); output[descriptor + 10] = name.length; output[descriptor + 11] = 1;
        for (let i = 0; i < name.length; i++) view.setUint16(descriptor + 16 + i * 2, name.charCodeAt(i), true);
        encrypt(payload, bytes.length, block++);
        payload += bytes.length; descriptor += 18 + name.length * 2;
      }
      encrypt(offset, tableSize, 0); encrypt(0, 8, 0);
      return output;
    } catch (error) { cleanup(); throw error; }
  };
}
