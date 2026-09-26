import { md5, sha1 } from "@noble/hashes/legacy.js";
import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { rc4Stream } from "./biff-encryption.js";

export type BiffEncryptionProfile = { readonly algorithm: "xor" } | { readonly algorithm: "rc4" } |
  { readonly algorithm: "rc4-cryptoapi"; readonly keyBits: number };
export const biffEncryptionProfiles: ReadonlyMap<string, BiffEncryptionProfile> = new Map<string, BiffEncryptionProfile>([
  ["xor", { algorithm: "xor" }],
  ["rc4", { algorithm: "rc4" }],
  ...[40, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120, 128].map(bits =>
    [`rc4-cryptoapi-${bits}`, { algorithm: "rc4-cryptoapi", keyBits: bits }] as const)
]);
export const biffLegacyEncryptionOptions = [...biffEncryptionProfiles]
  .filter(([, profile]) => profile.algorithm === "xor").map(([name]) => name);

/** MS-OFFCRYPTO 2.3.5.1. This CSP supports RC4/SHA-1 and the full key range;
 * it is an on-file identifier, never a request to load a host provider. */
export function createBiffEncryptionHeader(profile: BiffEncryptionProfile, revision: 7 | 8 = 8): Uint8Array {
  if (profile.algorithm === "xor") return new Uint8Array(revision === 8 ? 6 : 4);
  if (profile.algorithm === "rc4") return new Uint8Array(54);
  const provider = "Microsoft Enhanced Cryptographic Provider v1.0";
  const headerSize = 32 + (provider.length + 1) * 2, bytes = new Uint8Array(14 + headerSize + 60);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 1, true); view.setUint16(2, 4, true); view.setUint16(4, 2, true);
  // fCryptoAPI and fDocProps: workbook data is encrypted, no ancillary streams.
  view.setUint32(6, 12, true); view.setUint32(10, headerSize, true); view.setUint32(14, 12, true);
  view.setUint32(22, 0x6801, true); view.setUint32(26, 0x8004, true);
  view.setUint32(30, profile.keyBits, true); view.setUint32(34, 1, true);
  for (let i = 0; i < provider.length; i++) view.setUint16(46 + i * 2, provider.charCodeAt(i), true);
  view.setUint32(14 + headerSize, 16, true); view.setUint32(50 + headerSize, 20, true);
  return bytes;
}

function unsupported(message: string): never {
  throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: encrypted Excel workbook ${message}`);
}

/** Encrypt an owned BIFF8 stream with its FILEPASS slot already included in all
 * offsets. MS-OFFCRYPTO 2.3.5/2.3.6 and MS-XLS 2.2.10: unauthenticated RC4. */
export async function encryptBiffStream(bytes: Uint8Array, context: CapabilityContext,
  profile: Exclude<BiffEncryptionProfile, { readonly algorithm: "xor" }> = { algorithm: "rc4" }): Promise<void> {
  context.signal.throwIfAborted();
  if (!context.password || !context.entropy) unsupported("export requires password and cryptographic entropy capabilities");
  // Admit the maximum password/KDF, verifier and every absolute-position block
  // before calling either host capability or allocating cryptographic material.
  const cryptoapi = profile.algorithm === "rc4-cryptoapi", hash = cryptoapi ? sha1 : md5;
  const keyBits = profile.algorithm === "rc4-cryptoapi" ? profile.keyBits : 128, hashLength = cryptoapi ? 20 : 16;
  const work = 1280 + 16 + hashLength + bytes.length + Math.ceil(bytes.length / 1024) * (64 + 256 + 1024);
  if (work > (context.limits.workbookWork ?? context.limits.inputBytes * 8))
    throw new SsconvertError("resource-limit", "ssconvert BIFF encryption work limit exceeded");
  let secret: string | Uint8Array | undefined;
  try {
    secret = await context.password.read(Object.freeze({ purpose: "encrypt", format: "biff", algorithm: profile.algorithm,
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
  const material = new Uint8Array(cryptoapi ? 16 + password.length : 336), prefix = cryptoapi ? 20 : 5;
  const keyInput = new Uint8Array(prefix + 4);
  const keyStream = (block: number, length: number): Uint8Array => {
    keyInput.set(base!.subarray(0, prefix)); new DataView(keyInput.buffer).setUint32(prefix, block, true);
    const digest = hash(keyInput), key = cryptoapi ? new Uint8Array(keyBits === 40 ? 16 : keyBits / 8) : digest;
    if (cryptoapi) key.set(digest.subarray(0, keyBits / 8));
    try { return rc4Stream(key, length, context); } finally { key.fill(0); digest.fill(0); }
  };
  try {
    let borrowed: Uint8Array | undefined;
    try { borrowed = await context.entropy.read(Object.freeze({ length: 32, signal: context.signal })); }
    catch { context.signal.throwIfAborted(); unsupported("entropy acquisition failed"); }
    context.signal.throwIfAborted();
    if (!(borrowed instanceof Uint8Array) || borrowed.length !== 32) unsupported("entropy must provide exactly 32 bytes");
    entropy = new Uint8Array(borrowed);
    if (cryptoapi) {
      if (entropy.subarray(0, 16).every((byte, i) => byte === entropy![i + 16])) unsupported("salt and verifier must differ");
      material.set(entropy.subarray(0, 16)); material.set(password, 16);
    } else {
      initial = md5(password);
      for (let i = 0; i < 16; i++) { material.set(initial.subarray(0, 5), i * 21); material.set(entropy.subarray(0, 16), i * 21 + 5); }
    }
    base = hash(material); verifierHash = hash(entropy.subarray(16)); stream = keyStream(0, 16 + hashLength);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const pass = 4 + view.getUint16(2, true);
    const headerSize = cryptoapi ? view.getUint32(pass + 14, true) : 0;
    if (view.getUint16(pass, true) !== 0x2f || view.getUint16(pass + 2, true) !== (cryptoapi ? 74 + headerSize : 54))
      throw new TypeError("Missing BIFF8 encryption header slot");
    if (!cryptoapi) bytes.set([1, 0, 1, 0, 1, 0], pass + 4);
    const salt = cryptoapi ? pass + 22 + headerSize : pass + 10, verifier = salt + 16;
    const verifierDigest = verifier + 16 + (cryptoapi ? 4 : 0);
    bytes.set(entropy.subarray(0, 16), salt);
    for (let i = 0; i < 16; i++) bytes[verifier + i] = entropy[16 + i]! ^ stream[i]!;
    for (let i = 0; i < hashLength; i++) bytes[verifierDigest + i] = verifierHash[i]! ^ stream[i + 16]!;
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
