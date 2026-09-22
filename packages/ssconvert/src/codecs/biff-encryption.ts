import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { Binary, invalidBiff, type BiffRecord } from "./biff-binary.js";
import { md5, sha1 } from "@noble/hashes/legacy.js";

/** MS-OFFCRYPTO RC4; never reused for new encryption or authentication. */
function rc4Stream(key: Uint8Array, length: number, context: CapabilityContext): Uint8Array {
  const state = Uint8Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + state[i]! + key[i % key.length]!) & 255;
    [state[i], state[j]] = [state[j]!, state[i]!];
  }
  const result = new Uint8Array(length);
  let i = 0; j = 0;
  for (let at = 0; at < length; at++) {
    if ((at & 255) === 0) context.signal.throwIfAborted();
    i = (i + 1) & 255; j = (j + state[i]!) & 255;
    [state[i], state[j]] = [state[j]!, state[i]!];
    result[at] = state[(state[i]! + state[j]!) & 255]!;
  }
  return result;
}

/** Decode admitted XOR/RC4 profiles; optional secret acquisition is explicit host authority. */
export async function decryptBiffRecords(records: BiffRecord[], revision: number, context: CapabilityContext): Promise<void> {
  let array: Uint8Array | undefined, base: Uint8Array | undefined, work = 0;
  let block = -1, stream: Uint8Array | undefined;
  let cryptoapi = false, keyBits = 128;
  let hash: (bytes: Uint8Array) => Uint8Array = md5;
  const admit = (amount: number): void => {
    work += amount;
    if (work > (context.limits.workbookWork ?? context.limits.inputBytes * 8))
      throw new SsconvertError("resource-limit", "ssconvert BIFF decryption work limit exceeded");
  };
  // Reject ambiguous declarations before asking the host for a secret or decoding data.
  let declarations = 0;
  for (let index = 0; index < records.length; index++) {
    if ((index & 1023) === 0) context.signal.throwIfAborted();
    if (records[index]!.opcode === 0x2f && ++declarations > 1) invalidBiff("duplicate FILEPASS");
  }
  const acquire = async (algorithm: "xor" | "rc4" | "rc4-cryptoapi"): Promise<Uint8Array | undefined> => {
    if (!context.password) return undefined;
    context.signal.throwIfAborted();
    const xor = algorithm === "xor", maxBytes = xor ? 15 : 510;
    let secret: string | Uint8Array | undefined;
    try {
      secret = await context.password.read(Object.freeze({ format: "biff", algorithm, revision,
        encoding: xor ? "bytes" : "utf16le", maxBytes, signal: context.signal,
        ...(context.inputFilename === undefined ? {} : { inputFilename: context.inputFilename }) }));
    } catch {
      context.signal.throwIfAborted();
      throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: encrypted Excel workbook password acquisition failed");
    }
    context.signal.throwIfAborted();
    if (secret === undefined) return undefined;
    if (typeof secret === "string" && !xor && secret.length <= 255) {
      const encoded = new Uint8Array(secret.length * 2), view = new DataView(encoded.buffer);
      for (let index = 0; index < secret.length; index++) view.setUint16(index * 2, secret.charCodeAt(index), true);
      return encoded;
    }
    if (secret instanceof Uint8Array && secret.byteLength <= maxBytes &&
        (xor || secret.byteLength % 2 === 0)) return new Uint8Array(secret);
    throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: encrypted Excel workbook password encoding or length");
  };
  const blockKey = (number: number): Uint8Array => {
    const prefix = cryptoapi ? 20 : 5, input = new Uint8Array(prefix + 4);
    input.set(base!.subarray(0, prefix));
    new DataView(input.buffer).setUint32(prefix, number, true);
    const digest = hash(input);
    if (!cryptoapi) return digest;
    const key = new Uint8Array(keyBits === 40 ? 16 : keyBits / 8);
    key.set(digest.subarray(0, keyBits / 8));
    return key;
  };
  for (let at = 0; at < records.length; at++) {
    context.signal.throwIfAborted();
    const record = records[at]!, data = record.data, opcode = record.opcode;
    if (opcode === 0x2f) {
      const prefix = revision >= 8 ? 2 : 0;
      const method = prefix ? data.u16(0) : 0;
      if (method === 1) {
        data.check(0, 6);
        const major = data.u16(2), minor = data.u16(4);
        let saltOffset = 6, verifierOffset = 22, hashOffset = 38, hashLength = 16;
        if (major >= 2 && major <= 4 && minor === 2) {
          cryptoapi = true; hash = sha1; hashLength = 20;
          const flags = data.u32(6), size = data.u32(10);
          data.check(14, size);
          if (size < 34 || size % 2) invalidBiff("invalid CryptoAPI header size");
          if (flags !== data.u32(14) || data.u32(18) !== 0) invalidBiff("invalid CryptoAPI header fields");
          if ((flags & 0x34) !== 4 || data.u32(22) !== 0x6801 || data.u32(26) !== 0x8004 || data.u32(34) !== 1)
            throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: encrypted Excel workbook method");
          if (!(flags & 8))
            throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: encrypted Excel workbook ancillary properties");
          keyBits = data.u32(30) || 40;
          if (keyBits < 40 || keyBits > 128 || keyBits % 8)
            throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: encrypted Excel workbook key size");
          admit(size);
          // Validate the Unicode declaration; no host CSP lookup/execution is needed.
          // MS-OFFCRYPTO2.3.5.1 footnote24: non-Windows readers use AlgID/KeySize.
          for (let offset = 46; offset < 14 + size; offset += 2) {
            if ((offset & 1023) === 0) context.signal.throwIfAborted();
            const unit = data.u16(offset);
            if (!unit) {
              if (offset !== 12 + size) invalidBiff("invalid CryptoAPI provider terminator");
            }
          }
          if (data.u16(12 + size) !== 0) invalidBiff("unterminated CryptoAPI provider");
          const verifierAt = 14 + size;
          data.check(verifierAt, 60);
          if (data.bytes.length !== verifierAt + 60 || data.u32(verifierAt) !== 16 || data.u32(verifierAt + 36) !== 20)
            invalidBiff("invalid CryptoAPI verifier size");
          saltOffset = verifierAt + 4; verifierOffset = verifierAt + 20; hashOffset = verifierAt + 40;
        } else if (major !== 1 || minor !== 1) {
          throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: encrypted Excel workbook method");
        } else if (data.bytes.length !== 54) invalidBiff("invalid RC4 FILEPASS size");
        const verify = (encoded: Uint8Array): boolean => {
          // Aggregate admission includes both attempts and longer host passwords.
          admit(800 + Math.max(0, encoded.length - 30));
          if (cryptoapi) {
            const material = new Uint8Array(16 + encoded.length);
            material.set(data.bytes.subarray(saltOffset, saltOffset + 16)); material.set(encoded, 16);
            base = hash(material);
          } else {
            const first = hash(encoded), material = new Uint8Array(336);
            for (let index = 0; index < 16; index++) {
              material.set(first.subarray(0, 5), index * 21);
              material.set(data.bytes.subarray(saltOffset, saltOffset + 16), index * 21 + 5);
            }
            base = hash(material);
          }
          const verifierStream = rc4Stream(blockKey(0), 16 + hashLength, context), verifier = new Uint8Array(16 + hashLength);
          for (let index = 0; index < verifier.length; index++)
            verifier[index] = data.bytes[index < 16 ? verifierOffset + index : hashOffset + index - 16]! ^ verifierStream[index]!;
          const expected = hash(verifier.subarray(0, 16));
          let difference = 0;
          for (let index = 0; index < hashLength; index++) difference |= expected[index]! ^ verifier[index + 16]!;
          if (difference) base = undefined;
          return difference === 0;
        };
        const password = "VelvetSweatshop", encoded = new Uint8Array(password.length * 2);
        for (let index = 0; index < password.length; index++) encoded[index * 2] = password.charCodeAt(index);
        if (!verify(encoded)) {
          const secret = await acquire(cryptoapi ? "rc4-cryptoapi" : "rc4");
          if (secret === undefined || !verify(secret))
            throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: encrypted Excel workbook password required");
        }
        continue;
      }
      if (method !== 0 || !prefix && data.bytes.length !== 4)
        throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: encrypted Excel workbook");
      data.check(0, prefix + 4);
      if (data.bytes.length !== prefix + 4) invalidBiff("invalid XOR FILEPASS size");
      const verify = (password: Uint8Array): boolean => {
        admit(password.length + 1);
        let verifier = 0;
        for (let index = password.length - 1; index >= -1; index--)
          verifier = ((verifier << 1) & 0x7fff | verifier >> 14) ^ (index < 0 ? password.length : password[index]!);
        return (verifier ^ 0xce4b) === data.u16(prefix + 2);
      };
      let password: Uint8Array = new TextEncoder().encode("VelvetSweatshop");
      if (!verify(password)) {
        const secret = await acquire("xor");
        if (secret === undefined || !verify(secret))
          throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: encrypted Excel workbook password required");
        password = secret;
      }
      const key = data.u16(prefix);
      const padding = [0xbb, 0xff, 0xff, 0xba, 0xff, 0xff, 0xb9, 0x80, 0x00, 0xbe, 0x0f, 0x00, 0xbf, 0x0f, 0x00, 0x00];
      array = Uint8Array.from({ length: 16 }, (_, index) => {
        const byte = index < password.length ? password[index]! : padding[index - password.length]!;
        const mixed = byte ^ (index % 2 ? key >> 8 : key & 255);
        return mixed >> 1 | mixed << 7;
      });
      continue;
    }
    // MS-XLS2.2.10: plaintext framing/BOFs and the enumerated clear records.
    if (!array && !base || [9, 0x209, 0x409, 0x809, 0x194, 0x195, 0xe1, 0x196, 0x138].includes(opcode)) continue;
    const start = opcode === 0x85 ? 4 : 0; // BoundSheet's lbPlyPos is plaintext.
    data.check(0, start);
    const count = data.bytes.length - start;
    let blocks = 0;
    if (base && count) {
      const first = Math.floor((record.offset + 4 + start) / 1024), last = Math.floor((record.offset + 3 + data.bytes.length) / 1024);
      blocks = last - first + 1 - (first === block ? 1 : 0);
    }
    // Each new absolute-position block includes hashing, KSA and all 1024 stream bytes.
    // Plaintext gaps advance offsets without generating or charging unused blocks.
    admit(count + blocks * (64 + 256 + 1024));
    const decoded = data.bytes.slice(), end = record.offset + 4 + decoded.length;
    for (let index = start; index < decoded.length; index++) {
      if ((index & 1023) === 0) context.signal.throwIfAborted();
      if (base) {
        const absolute = record.offset + 4 + index, number = Math.floor(absolute / 1024);
        if (number !== block) { stream = rc4Stream(blockKey(number), 1024, context); block = number; }
        decoded[index] = decoded[index]! ^ stream![absolute % 1024]!;
      } else {
        const value = decoded[index]! ^ array![(end + index) % 16]!;
        decoded[index] = value >> 5 | value << 3;
      }
    }
    records[at] = { ...record, data: new Binary(decoded) };
  }
}
