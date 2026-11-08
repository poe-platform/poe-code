export class Reader {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  check(offset: number, size: number): void {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(size) ||
      offset < 0 ||
      size < 0 ||
      size > this.bytes.length - offset
    ) {
      throw new Error("Truncated or invalid audio structure");
    }
  }
  slice(offset: number, size: number): Uint8Array {
    this.check(offset, size);
    return this.bytes.subarray(offset, offset + size);
  }
  text(offset: number, size: number): string {
    return new TextDecoder("latin1").decode(this.slice(offset, size));
  }
  u8(offset: number): number {
    this.check(offset, 1);
    return this.view.getUint8(offset);
  }
  u16(offset: number, little = false): number {
    this.check(offset, 2);
    return this.view.getUint16(offset, little);
  }
  u24(offset: number, little = false): number {
    this.check(offset, 3);
    return little
      ? this.u8(offset) + this.u8(offset + 1) * 256 + this.u8(offset + 2) * 65536
      : this.u8(offset) * 65536 + this.u8(offset + 1) * 256 + this.u8(offset + 2);
  }
  u32(offset: number, little = false): number {
    this.check(offset, 4);
    return this.view.getUint32(offset, little);
  }
  u64(offset: number, little = false): bigint {
    this.check(offset, 8);
    return this.view.getBigUint64(offset, little);
  }
  safe64(offset: number, little = false): number {
    const value = this.u64(offset, little);
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new Error("Audio integer exceeds safe precision");
    return Number(value);
  }
}
export function join(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
export function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}
export function uint32(value: number, little = false): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, little);
  return bytes;
}
export function cleanText(text: string): string {
  const zero = text.indexOf("\0");
  return (zero < 0 ? text : text.slice(0, zero)).trimEnd();
}
export function duration(samples: number, sampleRate: number): number {
  if (!Number.isFinite(samples) || samples < 0 || !Number.isInteger(sampleRate) || sampleRate <= 0)
    throw new Error("Invalid audio timing");
  return samples / sampleRate;
}
