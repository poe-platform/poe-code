import { SsconvertError, type CapabilityContext, type RangeSource } from "@poe-code/spreadsheet-engine/contracts";
import type { BiffRc4Cipher } from "./biff-encryption.js";
import { Binary, invalidBiff } from "./biff-binary.js";
import { biffPropertyFormats } from "./biff-properties.js";
import { propertyRange, readPropertySectionRanges, readPropertyValueRanges } from "./biff-property-range.js";

/** Admit the outer container and reject hidden plaintext property collisions
 * before asking for a password. POI emits an empty document-summary placeholder. */
export async function encryptedBiffPropertyStream(streams: ReadonlyMap<string, Uint8Array> | undefined,
  context: CapabilityContext, charge: (amount: number) => void, propertySources?: ReadonlyMap<string, RangeSource>): Promise<Uint8Array> {
  let encrypted: Uint8Array | undefined, nodes = 0;
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
    if (key === "ENCRYPTION") { encrypted = bytes; continue; }
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
  if (encrypted.length > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert encrypted BIFF property input limit exceeded");
  new Binary(encrypted).check(0, 8);
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
    const source = new Binary(encrypted), header = new Binary(decrypt(source.slice(0, 8), 0));
    const offset = header.u32(0), size = header.u32(4); header.bytes.fill(0);
    if (offset < 8 || size < 4) invalidBiff("invalid encrypted property descriptor range");
    source.check(offset, size);
    const table = new Binary(decrypt(source.slice(offset, size), 0)), count = table.u32(0);
    if (count > Math.floor((size - 4) / 18)) invalidBiff("invalid encrypted property descriptor count");
    if (count > (context.limits.workbookNodes ?? context.limits.inputBytes))
      throw new SsconvertError("resource-limit", "ssconvert encrypted BIFF property node limit exceeded");
    charge(count); let at = 4, textBytes = 0;
    const descriptors: { offset: number; size: number; block: number; name: string }[] = [], names = new Set<string>();
    for (let i = 0; i < count; i++) {
      context.signal.throwIfAborted(); table.check(at, 18);
      const start = table.u32(at), length = table.u32(at + 4), block = table.u16(at + 8), nameLength = table.u8(at + 10), flags = table.u8(at + 11);
      if (flags !== 1 || table.u32(at + 12) !== 0) invalidBiff("invalid encrypted property descriptor flags");
      at += 16;
      if (!nameLength || nameLength > 31) invalidBiff("invalid encrypted property stream name");
      table.check(at, (nameLength + 1) * 2); charge(nameLength);
      if (table.u16(at + nameLength * 2) !== 0) invalidBiff("unterminated encrypted property stream name");
      textBytes += nameLength * 3;
      if (textBytes > (context.limits.workbookTextBytes ?? context.limits.inputBytes))
        throw new SsconvertError("resource-limit", "ssconvert encrypted BIFF property text limit exceeded");
      let name: string;
      try { name = new TextDecoder("utf-16le", { fatal: true, ignoreBOM: true }).decode(table.slice(at, nameLength * 2)); }
      catch { invalidBiff("invalid encrypted property stream name"); }
      if (name.includes("\0") || names.has(name.toUpperCase())) invalidBiff("duplicate or invalid encrypted property stream name");
      names.add(name.toUpperCase());
      at += (nameLength + 1) * 2; source.check(start, length);
      if (start < 8 || start < offset + size && start + length > offset) invalidBiff("overlapping encrypted property ranges");
      descriptors.push({ offset: start, size: length, block, name });
    }
    if (at !== size) invalidBiff("invalid encrypted property descriptor size");
    table.bytes.fill(0);
    charge(count * Math.ceil(Math.log2(count + 1)));
    const ordered = [...descriptors].sort((a, b) => a.offset - b.offset);
    for (let i = 1; i < ordered.length; i++) if (ordered[i]!.offset < ordered[i - 1]!.offset + ordered[i - 1]!.size)
      invalidBiff("overlapping encrypted property payloads");
    for (const entry of descriptors) result.set(entry.name, decrypt(source.slice(entry.offset, entry.size), entry.block));
    return result;
  } catch (error) { cleanup(); throw error; }
}
