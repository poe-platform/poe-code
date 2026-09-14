import type {ExecutionMeter} from "./execution-budget.js";

/** binascii.crc32 byte kernel with the reflected ZIP polynomial. The native
 * binding owns buffer acquisition and Python integer-to-unsigned-int masking;
 * initial is that 32-bit seed. Complementing at both boundaries permits the
 * returned unsigned checksum to seed the next chunk, including empty chunks.
 * No host zlib, platform byte order or mutable lookup table participates. */
export function crc32(input: Uint8Array, initial = 0, meter?: ExecutionMeter): number {
  meter?.checkpoint();
  let crc = initial ^ -1;
  for (const byte of input) {
    meter?.checkpoint(8);
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb88320);
  }
  meter?.checkpoint();
  return (crc ^ -1) >>> 0;
}

/** binascii.crc_hqx uses the unreflected CCITT polynomial and no complement.
 * The C unsigned seed is narrowed to 16 bits even for empty input. As with
 * crc32, the guest binding owns all argument and buffer protocol behavior. */
export function crcHqx(input: Uint8Array, initial: number, meter?: ExecutionMeter): number {
  meter?.checkpoint();
  let crc = initial & 0xffff;
  for (const byte of input) {
    meter?.checkpoint(8);
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ ((crc & 0x8000) === 0 ? 0 : 0x1021)) & 0xffff;
  }
  meter?.checkpoint();
  return crc;
}
