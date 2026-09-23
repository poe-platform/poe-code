import type { ByteSource } from "../../contracts/index.js";
import type { Session } from "./shared.js";

export interface StringRegion { readonly source: ByteSource; readonly offset: number }

export function dataMode(args: readonly string[]): boolean {
  let data = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (argument === "--") break;
    if (argument === "-") data = false;
    if (argument.startsWith("--")) {
      if (argument === "--data") data = true;
      else if (argument === "--all") data = false;
      else if (["--bytes", "--output-separator", "--radix", "--encoding", "--unicode", "--target"].includes(argument)) index++;
    } else if (argument.startsWith("-")) {
      for (let offset = 1; offset < argument.length; offset++) {
        const option = argument[offset]!;
        if (option === "a" || option === "d") data = option === "d";
        if ("nsteUT".includes(option)) {
          if (offset === argument.length - 1) index++;
          break;
        }
      }
    }
  }
  return data;
}

export async function stringRegions(source: ByteSource, session: Session, target: string | undefined): Promise<readonly StringRegion[]> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of source) {
    await session.step(chunk.length);
    size += chunk.length;
    session.check(size, session.limits.maxInputBytes, "input");
    chunks.push(new Uint8Array(chunk));
  }
  const bytes = new Uint8Array(size);
  let cursor = 0;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
  chunks.length = 0;
  const region = (offset: number, length: number): StringRegion => ({ offset, source: (async function* () {
    for (let index = offset; index < offset + length; index += session.limits.maxChunkBytes) {
      await session.step();
      yield bytes.subarray(index, Math.min(index + session.limits.maxChunkBytes, offset + length));
    }
  })() });
  const fallback = () => [region(0, size)];
  if (size < 52 || bytes[0] !== 127 || bytes[1] !== 69 || bytes[2] !== 76 || bytes[3] !== 70 || bytes[6] !== 1) return fallback();
  const wide = bytes[4] === 2;
  if ((!wide && bytes[4] !== 1) || (bytes[5] !== 1 && bytes[5] !== 2) || size < (wide ? 64 : 52)) return fallback();
  const little = bytes[5] === 1;
  const view = new DataView(bytes.buffer);
  const u16 = (offset: number) => view.getUint16(offset, little);
  const u32 = (offset: number) => view.getUint32(offset, little);
  const word = (offset: number) => wide ? Number(view.getBigUint64(offset, little)) : u32(offset);
  const machine = u16(18);
  if (target && !(little && (target === "elf64-x86-64" ? wide && machine === 62 : !wide && machine === 3))) return fallback();
  const table = word(wide ? 40 : 32), stride = u16(wide ? 58 : 46);
  let count = u16(wide ? 60 : 48);
  const valid = (offset: number, length: number) => Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 && length >= 0 && offset <= size && length <= size - offset;
  if (!table || stride < (wide ? 64 : 40) || !valid(table, stride)) return fallback();
  if (!count) count = word(table + (wide ? 32 : 20));
  if (!Number.isSafeInteger(count) || !valid(table, count * stride)) return fallback();
  const regions: StringRegion[] = [];
  for (let index = 0; index < count; index++) {
    await session.step();
    const header = table + index * stride;
    const type = u32(header + 4), flags = word(header + 8);
    if (type === 0 || type === 8 || !Number.isSafeInteger(flags) || Math.floor(flags / 2) % 2 !== 1) continue;
    const offset = word(header + (wide ? 24 : 16)), length = word(header + (wide ? 32 : 20));
    if (!valid(offset, length)) return fallback();
    regions.push(region(offset, length));
  }
  return regions;
}
