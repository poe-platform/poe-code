import { SsconvertError, type CapabilityContext, type RangeSource } from "@poe-code/spreadsheet-engine/contracts";
import { stagePropertyBytes } from "./biff-property-bytes.js";
import type { BiffPropertySource } from "./biff-encrypted-properties-write.js";
import type { BiffRc4Cipher } from "./biff-encryption.js";
import { Binary, invalidBiff } from "./biff-binary.js";
import { biffPropertyFormats } from "./biff-properties.js";
import { propertyRange, readPropertySectionRanges, readPropertyValueRanges } from "./biff-property-range.js";

/** Admit the outer container and reject hidden plaintext property collisions
 * before asking for a password. POI emits an empty document-summary placeholder. */
export async function encryptedBiffPropertyStream(streams: ReadonlyMap<string, Uint8Array> | undefined,
  context: CapabilityContext, charge: (amount: number) => void, propertySources?: ReadonlyMap<string, RangeSource>): Promise<Uint8Array | RangeSource> {
  let encrypted: Uint8Array | RangeSource | undefined, nodes = 0;
  const names = new Set<string>();
  const admit = (count: number) => {
    charge(count); nodes += count;
    if (nodes > (context.limits.workbookNodes ?? context.limits.inputBytes))
      throw new SsconvertError("resource-limit", "ssconvert encrypted BIFF property node limit exceeded");
  };
  for (const [name, bytes] of streams ?? []) {
    charge(name.length); const key = name.toUpperCase();
    if (!["ENCRYPTION", "\u0005SUMMARYINFORMATION", "\u0005DOCUMENTSUMMARYINFORMATION"].includes(key)) continue;
    if (names.has(key)) invalidBiff("duplicate encrypted property stream"); names.add(key);
    if (key === "ENCRYPTION") { const input = propertySources?.get(name); encrypted = input ? propertyRange(input, context) : bytes; continue; }
    const file = propertyRange(propertySources?.get(name) ?? bytes, context);
    if (file.size > context.limits.inputBytes) invalidBiff("invalid property source size");
    if (!file.size) continue;
    if (key === "\u0005SUMMARYINFORMATION") invalidBiff("ambiguous plaintext document properties");
    charge(file.size);
    for (const section of await readPropertySectionRanges(file, admit, charge)) {
      if (![biffPropertyFormats.document, biffPropertyFormats.custom].includes(section.guid)) invalidBiff("ambiguous plaintext document properties");
      const values = await readPropertyValueRanges(file.slice(section.offset, section.end - section.offset), admit, charge);
      for (const [id, value] of values) if (id > 1 || id === 0 && (await value.u32(0)) !== 0 || id === 1 && (await value.u32(0)) !== 2)
        invalidBiff("ambiguous plaintext document properties");
    }
  }
  if (!encrypted) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: encrypted Excel workbook ancillary properties require the encryption stream");
  const length = encrypted instanceof Uint8Array ? encrypted.length : encrypted.size;
  if (length > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert encrypted BIFF property input limit exceeded");
  if (length < 8) invalidBiff("truncated binary data");
  return encrypted;
}

/** MS-OFFCRYPTO 2.3.5.4: header/table restart block 0; each payload restarts its
 * descriptor block. These are not Workbook's absolute-position 1024-byte chunks. */
export function decryptBiffPropertyContainer(encrypted: Uint8Array, keyStream: (block: number, length: number) => Uint8Array,
  context: CapabilityContext, charge: (amount: number) => void, createCipher?: (block: number) => BiffRc4Cipher): ReadonlyMap<string, Uint8Array> {
  const owned: Uint8Array[] = [], result = new Map<string, Uint8Array>();
  let closed = false;
  const cleanup = () => { closed = true; for (const bytes of owned) bytes.fill(0); result.clear(); };
  context.own(cleanup);
  const check = () => {
    context.signal.throwIfAborted();
    if (closed) throw new SsconvertError("invalid-request", "Encrypted BIFF property reader disposed");
  };
  const decrypt = (bytes: Uint8Array, block: number) => {
    check();
    charge(bytes.length * 2 + 320);
    const output = bytes.slice(); owned.push(output);
    if (createCipher) {
      const cipher = createCipher(block);
      try {
        check();
        for (let at = 0; at < output.length; at += 16384) {
          cipher.xor(output.subarray(at, Math.min(output.length, at + 16384))); check();
        }
      } finally { cipher.close(); }
    } else {
      const stream = keyStream(block, bytes.length);
      try { check(); for (let i = 0; i < output.length; i++) { if (!(i % 1024)) check(); output[i] = output[i]! ^ stream[i]!; } }
      finally { stream.fill(0); }
    }
    return output;
  };
  try {
    check();
    if (encrypted.length > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert encrypted BIFF property input limit exceeded");
    const source = new Binary(encrypted), { offset, size } = propertyTableRange(decrypt(source.slice(0, 8), 0), source);
    const table = new Binary(decrypt(source.slice(offset, size), 0));
    const reader = readEncryptedPropertyDescriptors(source, offset, size, context, charge);
    let step = reader.next();
    while (!step.done) step = reader.next(table.slice(step.value.at, step.value.size));
    table.bytes.fill(0); const descriptors = step.value;
    for (const entry of descriptors) result.set(entry.name, decrypt(source.slice(entry.offset, entry.size), entry.block));
    return result;
  } catch (error) { cleanup(); throw error; }
}

function propertyTableRange(bytes: Uint8Array, source: { check(at: number, size: number): void }): { offset: number; size: number } {
  const header = new Binary(bytes), offset = header.u32(0), size = header.u32(4); bytes.fill(0);
  if (offset < 8 || size < 4) invalidBiff("invalid encrypted property descriptor range");
  source.check(offset, size); return { offset, size };
}
function* readEncryptedPropertyDescriptors(source: { check(at: number, size: number): void }, offset: number, size: number,
  context: CapabilityContext, charge: (amount: number) => void): Generator<{ at: number; size: number }, { offset: number; size: number; block: number; name: string }[], Uint8Array> {
  const count = new Binary(yield { at: 0, size: 4 }).u32(0);
  if (count > Math.floor((size - 4) / 18)) invalidBiff("invalid encrypted property descriptor count");
  if (count > (context.limits.workbookNodes ?? context.limits.inputBytes))
    throw new SsconvertError("resource-limit", "ssconvert encrypted BIFF property node limit exceeded");
  charge(count); let at = 4, textBytes = 0;
  const descriptors: { offset: number; size: number; block: number; name: string }[] = [], names = new Set<string>();
  for (let i = 0; i < count; i++) {
    context.signal.throwIfAborted();
    const entry = new Binary(yield { at, size: 18 }); entry.check(0, 18);
    const start = entry.u32(0), length = entry.u32(4), block = entry.u16(8), nameLength = entry.u8(10), flags = entry.u8(11);
    if (flags !== 1 || entry.u32(12) !== 0) invalidBiff("invalid encrypted property descriptor flags");
    at += 16;
    if (!nameLength || nameLength > 31) invalidBiff("invalid encrypted property stream name");
    const nameBytes = new Binary(yield { at, size: (nameLength + 1) * 2 }); nameBytes.check(0, (nameLength + 1) * 2); charge(nameLength);
    if (nameBytes.u16(nameLength * 2) !== 0) invalidBiff("unterminated encrypted property stream name");
    textBytes += nameLength * 3;
    if (textBytes > (context.limits.workbookTextBytes ?? context.limits.inputBytes))
      throw new SsconvertError("resource-limit", "ssconvert encrypted BIFF property text limit exceeded");
    let name: string;
    try { name = new TextDecoder("utf-16le", { fatal: true, ignoreBOM: true }).decode(nameBytes.slice(0, nameLength * 2)); }
    catch { invalidBiff("invalid encrypted property stream name"); }
    if (name.includes("\0") || names.has(name.toUpperCase())) invalidBiff("duplicate or invalid encrypted property stream name");
    names.add(name.toUpperCase());
    at += (nameLength + 1) * 2; source.check(start, length);
    if (start < 8 || start < offset + size && start + length > offset) invalidBiff("overlapping encrypted property ranges");
    descriptors.push({ offset: start, size: length, block, name });
  }
  if (at !== size) invalidBiff("invalid encrypted property descriptor size");
  charge(count * Math.ceil(Math.log2(count + 1)));
  const ordered = [...descriptors].sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < ordered.length; i++) if (ordered[i]!.offset < ordered[i - 1]!.offset + ordered[i - 1]!.size)
    invalidBiff("overlapping encrypted property payloads");
  return descriptors;
}

/** Decrypt retained ciphertext and descriptor bytes directly into caller storage.
 * Parsed descriptors and names remain resident; plaintext transfers are bounded. */
export async function decryptBiffPropertySources(encrypted: Uint8Array | RangeSource, createCipher: (block: number) => BiffRc4Cipher,
  context: CapabilityContext, charge: (amount: number) => void): Promise<ReadonlyMap<string, BiffPropertySource>> {
  const result = new Map<string, BiffPropertySource>(), owned: Uint8Array[] = [];
  const input = propertyRange(encrypted, context);
  let closed = false;
  const check = () => { context.signal.throwIfAborted(); if (closed) throw new SsconvertError("invalid-request", "Encrypted BIFF property reader disposed"); };
  const close = async () => {
    closed = true; for (const bytes of owned) bytes.fill(0);
    const outcomes = await Promise.allSettled([...result.values()].map(source => source.close())); result.clear();
    const errors = outcomes.filter((value): value is PromiseRejectedResult => value.status === "rejected").map(value => value.reason);
    if (errors.length) throw new AggregateError(errors, "Encrypted BIFF property cleanup failed");
  };
  context.own(close);
  async function* chunks(offset: number, size: number, block: number): AsyncIterable<Uint8Array> {
    check(); input.check(offset, size); charge(size * 2 + 320);
    const cipher = createCipher(block);
    try {
      check();
      for (let at = 0; at < size;) {
        const output = await input.read(offset + at, Math.min(16384, size - at), { signal: context.signal }); at += output.length;
        try { cipher.xor(output); check(); yield output; check(); } finally { output.fill(0); }
      }
    } finally { cipher.close(); }
  }
  try {
    check();
    if (input.size > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert encrypted BIFF property input limit exceeded");
    const decrypt = async (offset: number, size: number) => {
      input.check(offset, size);
      const output = new Uint8Array(size); owned.push(output); let at = 0;
      for await (const part of chunks(offset, size, 0)) { output.set(part, at); at += part.length; }
      return output;
    };
    const { offset, size } = propertyTableRange(await decrypt(0, 8), input);
    const table = await stagePropertyBytes({ length: size, chunks: () => chunks(offset, size, 0) }, context, context.limits.inputBytes);
    const reader = readEncryptedPropertyDescriptors(input, offset, size, context, charge);
    let step = reader.next();
    try {
      while (!step.done) {
        const bytes = await table.read(step.value.at, step.value.size, { signal: context.signal });
        try { check(); step = reader.next(bytes); } finally { bytes.fill(0); }
      }
    } catch (error) {
      try { await table.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Encrypted BIFF descriptor read and cleanup failed"); }
      throw error;
    }
    await table.close(); check();
    const descriptors = step.value;
    for (const entry of descriptors) {
      const source = await stagePropertyBytes({ length: entry.size, chunks: () => chunks(entry.offset, entry.size, entry.block) }, context, context.limits.inputBytes);
      result.set(entry.name, source); check();
    }
    return result;
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], "Encrypted BIFF property read and cleanup failed"); }
    throw error;
  } finally { for (const bytes of owned) bytes.fill(0); owned.length = 0; }
}
