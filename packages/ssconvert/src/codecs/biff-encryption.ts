import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { Binary, invalidBiff, type BiffRecord } from "./biff-binary.js";
import { md5 } from "@noble/hashes/legacy.js";

/** MS-OFFCRYPTO standard RC4; never reused for new encryption or authentication. */
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

/** Decode native built-in-password XOR/standard RC4 profiles without host authority. */
export function decryptBiffRecords(records: BiffRecord[], revision: number, context: CapabilityContext): void {
  let array: Uint8Array | undefined, base: Uint8Array | undefined, work = 0, seen = false;
  let block = -1, stream: Uint8Array | undefined;
  const admit = (amount: number): void => {
    work += amount;
    if (work > (context.limits.workbookWork ?? context.limits.inputBytes * 8))
      throw new SsconvertError("resource-limit", "ssconvert BIFF decryption work limit exceeded");
  };
  const blockKey = (number: number): Uint8Array => {
    const input = new Uint8Array(9);
    input.set(base!.subarray(0, 5));
    new DataView(input.buffer).setUint32(5, number, true);
    return md5(input);
  };
  for (let at = 0; at < records.length; at++) {
    context.signal.throwIfAborted();
    const record = records[at]!, data = record.data, opcode = record.opcode;
    if (opcode === 0x2f) {
      if (seen) invalidBiff("duplicate FILEPASS");
      seen = true;
      const prefix = revision >= 8 ? 2 : 0;
      const method = prefix ? data.u16(0) : 0;
      if (method === 1) {
        data.check(0, 6);
        if (data.u16(2) !== 1 || data.u16(4) !== 1)
          throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: encrypted Excel workbook method");
        if (data.bytes.length !== 54) invalidBiff("invalid RC4 FILEPASS size");
        // Charge fixed KDF, key scheduling and verifier work before crypto allocation.
        admit(800);
        const password = "VelvetSweatshop", encoded = new Uint8Array(password.length * 2);
        for (let index = 0; index < password.length; index++) encoded[index * 2] = password.charCodeAt(index);
        const first = md5(encoded), material = new Uint8Array(336);
        for (let index = 0; index < 16; index++) {
          material.set(first.subarray(0, 5), index * 21);
          material.set(data.bytes.subarray(6, 22), index * 21 + 5);
        }
        base = md5(material);
        const verifierStream = rc4Stream(blockKey(0), 32, context), verifier = new Uint8Array(32);
        for (let index = 0; index < 32; index++) verifier[index] = data.bytes[index + 22]! ^ verifierStream[index]!;
        const hash = md5(verifier.subarray(0, 16));
        let difference = 0;
        for (let index = 0; index < 16; index++) difference |= hash[index]! ^ verifier[index + 16]!;
        if (difference)
          throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: encrypted Excel workbook password required");
        continue;
      }
      if (method !== 0 || !prefix && data.bytes.length !== 4)
        throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: encrypted Excel workbook");
      data.check(0, prefix + 4);
      if (data.bytes.length !== prefix + 4) invalidBiff("invalid XOR FILEPASS size");
      const password = "VelvetSweatshop";
      let verifier = 0;
      for (const byte of [...password].map(char => char.charCodeAt(0)).reverse().concat(password.length))
        verifier = ((verifier << 1) & 0x7fff | verifier >> 14) ^ byte;
      if ((verifier ^ 0xce4b) !== data.u16(prefix + 2))
        throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: encrypted Excel workbook password required");
      const key = data.u16(prefix);
      array = Uint8Array.from([...new TextEncoder().encode(password), 0xbb, 0xff], (byte, index) => {
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
    // Each new absolute-position block includes MD5, KSA and all 1024 stream bytes.
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
