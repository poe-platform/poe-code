import { SsconvertError, type CapabilityContext, type RangeSource } from "@poe-code/spreadsheet-engine/contracts";

// MS-OFFCRYPTO 2.3.7.2, XOR Method 1. These public constants are not key material.
const initialCode = [0xe1f0, 0x1d0f, 0xcc9c, 0x84c0, 0x110c, 0x0e10, 0xf1ce, 0x313e,
  0x1872, 0xe139, 0xd40f, 0x84f9, 0x280c, 0xa96a, 0x4ec3];
const xorMatrix = [
  0xaefc, 0x4dd9, 0x9bb2, 0x2745, 0x4e8a, 0x9d14, 0x2a09,
  0x7b61, 0xf6c2, 0xfda5, 0xeb6b, 0xc6f7, 0x9dcf, 0x2bbf,
  0x4563, 0x8ac6, 0x05ad, 0x0b5a, 0x16b4, 0x2d68, 0x5ad0,
  0x0375, 0x06ea, 0x0dd4, 0x1ba8, 0x3750, 0x6ea0, 0xdd40,
  0xd849, 0xa0b3, 0x5147, 0xa28e, 0x553d, 0xaa7a, 0x44d5,
  0x6f45, 0xde8a, 0xad35, 0x4a4b, 0x9496, 0x390d, 0x721a,
  0xeb23, 0xc667, 0x9cef, 0x29ff, 0x53fe, 0xa7fc, 0x5fd9,
  0x47d3, 0x8fa6, 0x0f6d, 0x1eda, 0x3db4, 0x7b68, 0xf6d0,
  0xb861, 0x60e3, 0xc1c6, 0x93ad, 0x377b, 0x6ef6, 0xddec,
  0x45a0, 0x8b40, 0x06a1, 0x0d42, 0x1a84, 0x3508, 0x6a10,
  0xaa51, 0x4483, 0x8906, 0x022d, 0x045a, 0x08b4, 0x1168,
  0x76b4, 0xed68, 0xcaf1, 0x85c3, 0x1ba7, 0x374e, 0x6e9c,
  0x3730, 0x6e60, 0xdcc0, 0xa9a1, 0x4363, 0x86c6, 0x1dad,
  0x3331, 0x6662, 0xccc4, 0x89a9, 0x0373, 0x06e6, 0x0dcc,
  0x1021, 0x2042, 0x4084, 0x8108, 0x1231, 0x2462, 0x48c4
];
const padding = [0xbb, 0xff, 0xff, 0xba, 0xff, 0xff, 0xb9, 0x80, 0x00, 0xbe, 0x0f, 0x00, 0xbf, 0x0f, 0x00];

export interface BiffXorSource extends RangeSource {
  patch(position: number, bytes: Uint8Array): Promise<void>;
}
const plaintextRecords = new Set([9, 0x209, 0x409, 0x809, 0x2f, 0x194, 0x195, 0xe1, 0x196, 0x138]);

/** Obfuscate every owned stream, including a DSF file's BIFF7 fallback. XOR has
 * no security or authentication properties and needs no entropy capability. */
export async function encryptBiffXorStreams(streams: readonly (Uint8Array | BiffXorSource)[], revision: 7 | 8,
  context: CapabilityContext): Promise<void> {
  context.signal.throwIfAborted();
  if (!context.password) throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: XOR export requires a password capability");
  const sources = streams.map(source => {
    if (source instanceof Uint8Array) return source;
    const size = source.size;
    if (!Number.isSafeInteger(size) || size < 0) throw new SsconvertError("invalid-request", "Invalid BIFF XOR output size");
    return { size, read: source.read.bind(source), patch: source.patch.bind(source) };
  });
  const work = 256 + sources.reduce((sum, stream) => sum + (stream instanceof Uint8Array ? stream.length : stream.size), 0);
  if (work > (context.limits.workbookWork ?? context.limits.inputBytes * 8))
    throw new SsconvertError("resource-limit", "ssconvert BIFF encryption work limit exceeded");
  let secret: string | Uint8Array | undefined;
  try {
    secret = await context.password.read(Object.freeze({ purpose: "encrypt", format: "biff", algorithm: "xor",
      revision, encoding: "bytes", maxBytes: 15, signal: context.signal,
      ...(context.outputFilename === undefined ? {} : { outputFilename: context.outputFilename }) }));
  } catch {
    context.signal.throwIfAborted();
    throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: encrypted Excel workbook password acquisition failed");
  }
  context.signal.throwIfAborted();
  // Method 1's key derivation indexes InitialCode[length - 1]. Empty-password
  // import uses an existing file key; it does not define a writer key.
  if (!(secret instanceof Uint8Array) || !secret.length || secret.length > 15)
    throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: XOR export requires 1 to 15 explicitly encoded password bytes");
  const password = new Uint8Array(secret), array = new Uint8Array(16);
  try {
    let key = initialCode[password.length - 1]!, matrix = 104, verifier = 0;
    for (let i = password.length - 1; i >= 0; i--) {
      let char = password[i]!;
      for (let bit = 0; bit < 7; bit++, matrix--, char <<= 1) if (char & 0x40) key ^= xorMatrix[matrix]!;
    }
    for (let i = password.length - 1; i >= -1; i--)
      verifier = ((verifier << 1) & 0x7fff | verifier >> 14) ^ (i < 0 ? password.length : password[i]!);
    verifier ^= 0xce4b;
    for (let i = 0; i < array.length; i++) {
      const byte = (i < password.length ? password[i]! : padding[i - password.length]!) ^ (i % 2 ? key >> 8 : key & 255);
      array[i] = byte >> 1 | byte << 7;
    }
    for (const bytes of sources) {
      if (!(bytes instanceof Uint8Array)) {
        await encryptSource(bytes, key, verifier, array, context);
        continue;
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const pass = 4 + view.getUint16(2, true), length = view.getUint16(pass + 2, true);
      if (view.getUint16(pass, true) !== 0x2f || length !== (view.getUint16(4, true) === 0x600 ? 6 : 4))
        throw new TypeError("Missing BIFF XOR encryption header slot");
      view.setUint16(pass + length, key, true); view.setUint16(pass + length + 2, verifier, true);
      for (let at = 0; at < bytes.length;) {
        context.signal.throwIfAborted();
        const opcode = view.getUint16(at, true), size = view.getUint16(at + 2, true), end = at + 4 + size;
        // MS-XLS 2.2.10: framing, BOF, FILEPASS and lbPlyPos remain plaintext.
        if (!plaintextRecords.has(opcode)) {
          for (let index = opcode === 0x85 ? 4 : 0; index < size; index++) {
            if ((index & 1023) === 0) context.signal.throwIfAborted();
            const offset = at + 4 + index, byte = bytes[offset]!;
            bytes[offset] = (byte << 5 | byte >> 3) ^ array[(end + index) % 16]!;
          }
        }
        at = end;
      }
    }
  } finally { password.fill(0); array.fill(0); }
}

/** Record-end-relative XOR indexes remain unchanged across bounded transfer windows. */
async function encryptSource(source: BiffXorSource, key: number, verifier: number, array: Uint8Array,
  context: CapabilityContext): Promise<void> {
  const size = source.size;
  async function read(position: number, length: number): Promise<Uint8Array> {
    context.signal.throwIfAborted();
    if (position < 0 || position > size - length) throw new SsconvertError("io", "Truncated BIFF XOR output");
    const bytes = new Uint8Array(length);
    try {
      for (let at = 0; at < length;) {
        const part = await source.read(position + at, length - at, { signal: context.signal });
        context.signal.throwIfAborted();
        if (!part.length || part.length > length - at) throw new SsconvertError("io", "Truncated BIFF XOR output");
        bytes.set(part, at); at += part.length;
      }
      return bytes;
    } catch (error) { bytes.fill(0); throw error; }
  }
  const bof = await read(0, 6), bofView = new DataView(bof.buffer);
  const pass = 4 + bofView.getUint16(2, true), revision = bofView.getUint16(4, true);
  const header = await read(pass, 4), view = new DataView(header.buffer), length = view.getUint16(2, true);
  if (view.getUint16(0, true) !== 0x2f || length !== (revision === 0x600 ? 6 : 4))
    throw new TypeError("Missing BIFF XOR encryption header slot");
  if (pass + 4 + length > size) throw new SsconvertError("io", "Truncated BIFF XOR output");
  const keys = new Uint8Array(4), keyView = new DataView(keys.buffer);
  keyView.setUint16(0, key, true); keyView.setUint16(2, verifier, true);
  try { await source.patch(pass + length, keys); context.signal.throwIfAborted(); }
  finally { keys.fill(0); }
  for (let at = 0; at < size;) {
    const header = await read(at, 4), view = new DataView(header.buffer);
    const opcode = view.getUint16(0, true), length = view.getUint16(2, true), end = at + 4 + length;
    if (end > size) throw new SsconvertError("io", "Truncated BIFF XOR output");
    if (!plaintextRecords.has(opcode)) {
      for (let index = opcode === 0x85 ? 4 : 0; index < length;) {
        const bytes = await read(at + 4 + index, Math.min(16384, length - index));
        try {
          for (let i = 0; i < bytes.length; i++) {
            if ((i & 1023) === 0) context.signal.throwIfAborted();
            const byte = bytes[i]!; bytes[i] = (byte << 5 | byte >> 3) ^ array[(end + index + i) % 16]!;
          }
          await source.patch(at + 4 + index, bytes); context.signal.throwIfAborted(); index += bytes.length;
        } finally { bytes.fill(0); }
      }
    }
    at = end;
  }
}
