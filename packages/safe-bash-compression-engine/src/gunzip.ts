import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { ByteSource } from "safe-bash-contracts";
import { codec, CodecReader, type CodecInput } from "./codec.js";
import { uncompress } from "./uncompress.js";

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

function updateCrc(value: number, bytes: Uint8Array): number {
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 255]!;
  return value >>> 0;
}

class Input {
  private pending: Uint8Array = new Uint8Array();
  private pulls = 0;
  constructor(private readonly upstream: CodecInput, private readonly signal: AbortSignal) {}
  async chunk(): Promise<Uint8Array | undefined> {
    this.signal.throwIfAborted();
    if (this.pending.length) { const result = this.pending; this.pending = new Uint8Array(); return result; }
    if (++this.pulls % 64 === 0) await yieldTurn(this.signal);
    return this.upstream.chunk();
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
  release(): void { this.upstream.restore(this.pending); }
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
  const reader = new CodecReader(source, signal);
  const input = new Input(reader, signal);
  let members = 0;
  try {
    for (;;) {
      const first = await input.byte();
      if (first === undefined) {
        if (!members && !force) throw new PublicDiagnostic("unexpected end of file");
        return;
      }
      const second = await input.byte();
      const prefix = second === undefined ? [first] : [first, second];
      if (!members && first === 0x50 && second === 0x4b) {
        const third = await input.byte();
        const fourth = third === undefined ? undefined : await input.byte();
        if (third !== undefined) prefix.push(third);
        if (fourth !== undefined) prefix.push(fourth);
        if (third === 3 && fourth === 4) {
          yield* decodeZipMember(input, signal);
          return;
        }
      }
      if (!members && first === 31 && second === 157) {
        yield* uncompress(input, await input.required(), signal);
        return;
      }
      if (first !== 31 || (second !== 139 && second !== 158)) {
        // GNU forced stdout/test passes non-member bytes through after valid members too.
        if (force) {
          yield Uint8Array.from(prefix);
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
      yield* decodeMember(input, signal, Uint8Array.of(first, second));
      members++;
    }
  } finally { controller.abort(); await reader.close(); }
}

// gzip reads the first deflated ZIP entry directly; it does not extract paths.
async function* decodeZipMember(input: Input, signal: AbortSignal): ByteSource {
  const fixed = await input.exact(26);
  const view = new DataView(fixed.buffer);
  const flags = view.getUint16(2, true);
  if (flags & 1) throw new PublicDiagnostic("encrypted ZIP entry is unsupported");
  if (view.getUint16(4, true) !== 8) throw new PublicDiagnostic("unsupported ZIP compression method");
  await input.exact(view.getUint16(22, true) + view.getUint16(24, true));
  let expectedCrc = view.getUint32(10, true);
  let expectedSize = view.getUint32(18, true);
  let crc = 0xffffffff;
  let size = 0;
  for await (const chunk of codec(input, { mode: "inflate-raw" }, signal)) {
    crc = updateCrc(crc, chunk);
    size += chunk.length;
    yield chunk;
  }
  if (flags & 8) {
    const first = new DataView((await input.exact(4)).buffer).getUint32(0, true);
    expectedCrc = first === 0x08074b50
      ? new DataView((await input.exact(4)).buffer).getUint32(0, true) : first;
    const sizes = new DataView((await input.exact(8)).buffer);
    expectedSize = sizes.getUint32(4, true);
  }
  if (((crc ^ 0xffffffff) >>> 0) !== expectedCrc) throw new PublicDiagnostic("incorrect data check (CRC)");
  if (size !== expectedSize) throw new PublicDiagnostic("incorrect length check");
}

async function* decodeMember(input: Input, signal: AbortSignal, magic: Uint8Array): ByteSource {
  await header(input, magic);
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
}

export async function* gunzipMember(reader: CodecInput, signal: AbortSignal): ByteSource {
  const input = new Input(reader, signal);
  try {
    const magic = await input.exact(2);
    if (magic[0] !== 31 || magic[1] !== 139) throw new PublicDiagnostic("not in gzip format");
    yield* decodeMember(input, signal, magic);
  } finally { input.release(); }
}
