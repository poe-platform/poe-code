import { md5 } from "@noble/hashes/legacy.js";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { rc4Stream } from "./biff-encryption.js";

function unsupported(message: string): never {
  throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: encrypted Excel workbook ${message}`);
}

/** Encrypt an owned BIFF8 stream with its FILEPASS slot already included in all
 * offsets. MS-OFFCRYPTO 2.3.6 and MS-XLS 2.2.10: legacy, unauthenticated RC4. */
export async function encryptBiffStream(bytes: Uint8Array, context: CapabilityContext): Promise<void> {
  context.signal.throwIfAborted();
  if (!context.password || !context.entropy) unsupported("export requires password and cryptographic entropy capabilities");
  // Admit the maximum password/KDF, verifier and every absolute-position block
  // before calling either host capability or allocating cryptographic material.
  const work = 1280 + 32 + bytes.length + Math.ceil(bytes.length / 1024) * (64 + 256 + 1024);
  if (work > (context.limits.workbookWork ?? context.limits.inputBytes * 8))
    throw new SsconvertError("resource-limit", "ssconvert BIFF encryption work limit exceeded");
  let secret: string | Uint8Array | undefined;
  try {
    secret = await context.password.read(Object.freeze({ purpose: "encrypt", format: "biff", algorithm: "rc4",
      revision: 8, encoding: "utf16le", maxBytes: 510, signal: context.signal,
      ...(context.outputFilename === undefined ? {} : { outputFilename: context.outputFilename }) }));
  } catch { context.signal.throwIfAborted(); unsupported("password acquisition failed"); }
  context.signal.throwIfAborted();
  if (secret === undefined) unsupported("password required");
  if (typeof secret === "string" ? secret.length > 255 :
    !(secret instanceof Uint8Array) || secret.length > 510 || secret.length % 2 !== 0) unsupported("password encoding or length");
  const password = typeof secret === "string" ? new Uint8Array(secret.length * 2) : new Uint8Array(secret);
  if (typeof secret === "string") {
    const view = new DataView(password.buffer);
    for (let i = 0; i < secret.length; i++) view.setUint16(i * 2, secret.charCodeAt(i), true);
  }
  let entropy: Uint8Array | undefined, initial: Uint8Array | undefined, base: Uint8Array | undefined;
  let stream: Uint8Array | undefined, verifierHash: Uint8Array | undefined;
  const material = new Uint8Array(336), keyInput = new Uint8Array(9);
  const keyStream = (block: number, length: number): Uint8Array => {
    keyInput.set(base!.subarray(0, 5)); new DataView(keyInput.buffer).setUint32(5, block, true);
    const key = md5(keyInput);
    try { return rc4Stream(key, length, context); } finally { key.fill(0); }
  };
  try {
    let borrowed: Uint8Array | undefined;
    try { borrowed = await context.entropy.read(Object.freeze({ length: 32, signal: context.signal })); }
    catch { context.signal.throwIfAborted(); unsupported("entropy acquisition failed"); }
    context.signal.throwIfAborted();
    if (!(borrowed instanceof Uint8Array) || borrowed.length !== 32) unsupported("entropy must provide exactly 32 bytes");
    entropy = new Uint8Array(borrowed); initial = md5(password);
    for (let i = 0; i < 16; i++) { material.set(initial.subarray(0, 5), i * 21); material.set(entropy.subarray(0, 16), i * 21 + 5); }
    base = md5(material); verifierHash = md5(entropy.subarray(16)); stream = keyStream(0, 32);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const pass = 4 + view.getUint16(2, true);
    if (view.getUint16(pass, true) !== 0x2f || view.getUint16(pass + 2, true) !== 54)
      throw new TypeError("Missing BIFF8 encryption header slot");
    bytes.set([1, 0, 1, 0, 1, 0], pass + 4); bytes.set(entropy.subarray(0, 16), pass + 10);
    for (let i = 0; i < 16; i++) {
      bytes[pass + 26 + i] = entropy[16 + i]! ^ stream[i]!;
      bytes[pass + 42 + i] = verifierHash[i]! ^ stream[i + 16]!;
    }
    stream.fill(0); stream = undefined;
    let block = -1;
    for (let at = 0; at < bytes.length;) {
      context.signal.throwIfAborted();
      const opcode = view.getUint16(at, true), length = view.getUint16(at + 2, true), end = at + 4 + length;
      // Record headers and the BoundSheet lbPlyPos field remain plaintext.
      if (![0x809, 0x2f, 0x194, 0x195, 0xe1, 0x196, 0x138].includes(opcode)) {
        for (let offset = at + 4 + (opcode === 0x85 ? 4 : 0); offset < end; offset++) {
          const number = Math.floor(offset / 1024);
          if (number !== block) { stream?.fill(0); stream = keyStream(number, 1024); block = number; }
          bytes[offset] = bytes[offset]! ^ stream![offset % 1024]!;
        }
      }
      at = end;
    }
  } finally {
    password.fill(0); entropy?.fill(0); initial?.fill(0); base?.fill(0); material.fill(0);
    keyInput.fill(0); stream?.fill(0); verifierHash?.fill(0);
  }
}
