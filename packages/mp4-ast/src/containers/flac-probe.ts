/** FLAC frame boundaries require both header CRC-8 and preceding frame CRC-16. */
function checksum(value: number, byte: number, width: number, polynomial: number): number {
  value ^= byte << (width - 8);
  for (let bit = 0; bit < 8; bit++) value = (value << 1) ^ (value & (1 << (width - 1)) ? polynomial : 0);
  return value & ((1 << width) - 1);
}

function frameHeader(bytes: Uint8Array, start: number): { duration: number; number: number; variable: boolean } | undefined {
  if (bytes[start] !== 255 || (bytes[start + 1]! & 254) !== 248 || (bytes[start + 3]! & 1)) return;
  const block = bytes[start + 2]! >>> 4, rate = bytes[start + 2]! & 15;
  if (!block || rate === 15 || bytes[start + 3]! >>> 4 > 10) return;
  let pos = start + 4, number = bytes[pos++]!;
  if (number >= 128) {
    let tails = 0, mask = 128;
    while (number & mask) { tails++; mask >>>= 1; }
    if (tails < 2 || tails > 7) return;
    number &= mask - 1;
    for (let i = 1; i < tails; i++) {
      const byte = bytes[pos++]!;
      if ((byte & 192) !== 128) return;
      number = number * 64 + (byte & 63);
    }
  }
  let duration = block === 1 ? 192 : block < 6 ? 576 * 2 ** (block - 2) : 256 * 2 ** (block - 8);
  if (block === 6) duration = bytes[pos++]! + 1;
  if (block === 7) { duration = bytes[pos]! * 256 + bytes[pos + 1]! + 1; pos += 2; }
  pos += rate === 12 ? 1 : rate >= 13 ? 2 : 0;
  if (pos >= bytes.length) return;
  let crc = 0;
  for (let i = start; i <= pos; i++) crc = checksum(crc, bytes[i]!, 8, 7);
  if (crc) return;
  return { duration, number, variable: !!(bytes[start + 1]! & 1) };
}

export class FlacFrameScanner {
  readonly header = new Uint8Array(42);
  readonly packets: { pts: number; duration: number; size: number; pos: number }[] = [];
  size = 0;
  private pending = new Uint8Array();
  private offset = 0;
  private metadataEnd = 4;
  private audio = false;
  private lastMetadata = false;
  private crc = 0;
  private frame: { pts: number; duration: number; pos: number } | undefined;
  private fixedBlockSize = 0;

  push(chunk: Uint8Array, final = false): void {
    if (this.size < 42) this.header.set(chunk.subarray(0, 42 - this.size), this.size);
    this.size += chunk.length;
    let bytes = chunk;
    if (this.pending.length) {
      bytes = new Uint8Array(this.pending.length + chunk.length);
      bytes.set(this.pending); bytes.set(chunk, this.pending.length);
    }
    let pos = 0;
    const end = final ? bytes.length : Math.max(0, bytes.length - 16);
    for (; pos < end; pos++, this.offset++) {
      if (!this.audio) {
        if (this.offset < this.metadataEnd) continue;
        if (!this.lastMetadata) {
          if (pos + 4 > bytes.length) break;
          this.lastMetadata = !!(bytes[pos]! & 128);
          this.metadataEnd = this.offset + 4 + bytes[pos + 1]! * 65536 + bytes[pos + 2]! * 256 + bytes[pos + 3]!;
          continue;
        }
        this.audio = true;
      }
      if (!this.frame || this.crc === 0) {
        const header = frameHeader(bytes, pos);
        if (header) {
          if (this.frame) this.packets.push({ ...this.frame, size: this.offset - this.frame.pos });
          this.fixedBlockSize ||= header.duration;
          this.frame = { pts: header.variable ? header.number : header.number * this.fixedBlockSize,
            duration: header.duration, pos: this.offset };
          this.crc = 0;
        }
      }
      if (this.frame) this.crc = checksum(this.crc, bytes[pos]!, 16, 0x8005);
    }
    this.pending = bytes.slice(pos);
    if (final && this.frame && this.crc === 0) {
      this.packets.push({ ...this.frame, size: this.offset - this.frame.pos });
      this.frame = undefined;
    }
  }
}
