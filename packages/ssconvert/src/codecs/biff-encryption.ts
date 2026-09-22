import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { Binary, invalidBiff, type BiffRecord } from "./biff-binary.js";

/** Decode the native reader's built-in-password XOR profile without host authority. */
export function decryptBiffRecords(records: BiffRecord[], revision: number, context: CapabilityContext): void {
  let array: Uint8Array | undefined, work = 0;
  for (let at = 0; at < records.length; at++) {
    context.signal.throwIfAborted();
    const record = records[at]!, data = record.data, opcode = record.opcode;
    if (opcode === 0x2f) {
      if (array) invalidBiff("duplicate FILEPASS");
      const prefix = revision >= 8 ? 2 : 0;
      if (prefix && data.u16(0) !== 0 || !prefix && data.bytes.length !== 4)
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
    if (!array || [9, 0x209, 0x409, 0x809, 0x194, 0x195, 0xe1, 0x196, 0x138].includes(opcode)) continue;
    const start = opcode === 0x85 ? 4 : 0; // BoundSheet's lbPlyPos is plaintext.
    data.check(0, start);
    work += data.bytes.length - start;
    if (work > (context.limits.workbookWork ?? context.limits.inputBytes * 8))
      throw new SsconvertError("resource-limit", "ssconvert BIFF decryption work limit exceeded");
    const decoded = data.bytes.slice(), end = record.offset + 4 + decoded.length;
    for (let index = start; index < decoded.length; index++) {
      if ((index & 1023) === 0) context.signal.throwIfAborted();
      const value = decoded[index]! ^ array[(end + index) % 16]!;
      decoded[index] = value >> 5 | value << 3;
    }
    records[at] = { ...record, data: new Binary(decoded) };
  }
}
