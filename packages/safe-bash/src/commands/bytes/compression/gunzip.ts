import { PublicDiagnostic } from "../../../diagnostics.js";
import { yieldTurn } from "../../../contracts/yield.js";
import { readBytes, type ByteSource } from "../../../contracts/index.js";
import { codec } from "./codec.js";

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

function updateCrc(value: number, bytes: Uint8Array): number {
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255]!;
  return value >>> 0;
}

class Input {
  private readonly iterator: AsyncGenerator<Uint8Array>;
  private pending: Uint8Array = new Uint8Array();
  private pulls = 0;
  constructor(source: ByteSource, private readonly signal: AbortSignal) { this.iterator = readBytes(source, signal); }
  async chunk(): Promise<Uint8Array | undefined> {
    this.signal.throwIfAborted();
    if (this.pending.length) { const result = this.pending; this.pending = new Uint8Array(); return result; }
    if (++this.pulls % 64 === 0) await yieldTurn(this.signal);
    const next = await this.iterator.next();
    return next.done ? undefined : next.value;
  }
  restore(bytes: Uint8Array): void { this.pending = bytes; }
  async byte(): Promise<number | undefined> {
    const chunk = await this.chunk();
    if (!chunk) return undefined;
    this.restore(chunk.subarray(1));
    return chunk[0]!;
  }
  async required(): Promise<number> {
    const value = await this.byte();
    if (value === undefined) throw new PublicDiagnostic("unexpected end of file");
    return value;
  }
  async exact(length: number): Promise<Uint8Array> {
    const result = new Uint8Array(length);
    for (let offset = 0; offset < length; offset++) result[offset] = await this.required();
    return result;
  }
  async close(): Promise<void> { await this.iterator.return(undefined); }
}

async function header(input: Input, magic: Uint8Array): Promise<void> {
  const fixed = await input.exact(8);
  if (fixed[0] !== 8) throw new PublicDiagnostic("unknown compression method");
  const flags = fixed[1]!;
  if (flags & 0xe0) throw new PublicDiagnostic("invalid gzip header flags");
  let crc = updateCrc(updateCrc(0xffffffff, magic), fixed);
  const next = async (): Promise<number> => {
    const value = await input.required();
    crc = ((crc >>> 8) ^ crcTable[(crc ^ value) & 255]!) >>> 0;
    return value;
  };
  if (flags & 4) {
    const length = (await next()) | ((await next()) << 8);
    for (let offset = 0; offset < length; offset++) await next();
  }
  for (const flag of [8, 16]) if (flags & flag) {
    for (;;) {
      if (await next() === 0) break;
    }
  }
  if (flags & 2) {
    const expected = (await input.required()) | ((await input.required()) << 8);
    if (((crc ^ 0xffffffff) & 0xffff) !== expected) throw new PublicDiagnostic("header crc mismatch");
  }
}

export async function* gunzipMembers(source: ByteSource, parentSignal: AbortSignal, force: boolean, warn: () => void): ByteSource {
  const controller = new AbortController();
  const signal = AbortSignal.any([parentSignal, controller.signal]);
  const input = new Input(source, signal);
  let members = 0;
  try {
    for (;;) {
      const first = await input.byte();
      if (first === undefined) {
        if (!members && !force) throw new PublicDiagnostic("unexpected end of file");
        return;
      }
      const second = await input.byte();
      if (first !== 31 || second !== 139) {
        if (force) {
          yield Uint8Array.from(second === undefined ? [first] : [first, second]);
          for (;;) { const chunk = await input.chunk(); if (!chunk) return; yield chunk; }
        }
        if (members && first === 0) {
          let garbage = second !== undefined && second !== 0;
          for (;;) {
            const chunk = await input.chunk();
            if (!chunk) break;
            if (chunk.some(value => value !== 0)) garbage = true;
          }
          if (garbage) warn();
          return;
        }
        if (second === undefined) throw new PublicDiagnostic("unexpected end of file");
        if (!members) throw new PublicDiagnostic("not in gzip format");
        warn();
        return;
      }
      await header(input, Uint8Array.of(first, second));
      let crc = 0xffffffff;
      let size = 0;
      for await (const chunk of codec(input, { mode: "inflate-raw" }, signal)) {
        crc = updateCrc(crc, chunk);
        size = (size + chunk.length) >>> 0;
        yield chunk;
      }
      const footer = await input.exact(8);
      const view = new DataView(footer.buffer, footer.byteOffset, footer.byteLength);
      if (((crc ^ 0xffffffff) >>> 0) !== view.getUint32(0, true)) throw new PublicDiagnostic("incorrect data check (CRC)");
      if (size !== view.getUint32(4, true)) throw new PublicDiagnostic("incorrect length check");
      members++;
    }
  } finally { controller.abort(); await input.close(); }
}
