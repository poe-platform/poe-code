import { Reader, cleanText } from "./binary.js";
import { infoNames, wavStream } from "./wav.js";
import type { AudioAst, AudioTags } from "./types.js";

/** Caller-owned retained bytes. This engine neither opens nor closes the source. */
export interface AudioProbeSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface WavTagSpan { readonly key: string; readonly offset: number; readonly length: number; }

/** Skip sample/unknown payloads and AST nodes. onTag exposes spans instead of materialized tag strings. */
export async function probeWavSource(source: AudioProbeSource, options: { signal?: AbortSignal; onTag?: (span: WavTagSpan) => Promise<void> } = {}): Promise<Omit<AudioAst, "data" | "nodes" | "pictures">> {
  const read = async (offset: number, size: number): Promise<Reader> => {
    options.signal?.throwIfAborted();
    if (!Number.isSafeInteger(source.size) || !Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || size > source.size - offset)
      throw new Error("Truncated or invalid audio structure");
    const bytes = await source.read(offset, size);
    options.signal?.throwIfAborted();
    if (bytes.length !== size) throw new Error("Truncated or invalid audio structure");
    return new Reader(bytes);
  };
  const header = await read(0, 12);
  if (header.text(0, 4) !== "RIFF" || header.text(8, 4) !== "WAVE") throw new Error("Expected RIFF WAVE");
  const riffSize = header.u32(4, true), end = riffSize === 0xffffffff ? source.size : riffSize + 8;
  if (end > source.size) throw new Error("Truncated or invalid audio structure");
  const tags: AudioTags = {};
  let format = 0, sampleRate = 0, channels = 0, bits = 0, validBits = 0, align = 0, dataSize = 0;
  let hasFmt = false, hasData = false;
  for (let offset = 12; offset < end;) {
    const chunk = await read(offset, 8), type = chunk.text(0, 4), declaredSize = chunk.u32(4, true), start = offset + 8;
    const size = type === "data" && declaredSize === 0xffffffff ? end - start : declaredSize;
    if (size > end - start) throw new Error("WAV chunk exceeds RIFF bounds");
    if (type === "fmt ") {
      if (size < 16) throw new Error("Short WAV fmt chunk");
      const fmt = await read(start, Math.min(size, 40));
      format = fmt.u16(0, true); channels = fmt.u16(2, true); sampleRate = fmt.u32(4, true);
      align = fmt.u16(12, true); bits = fmt.u16(14, true); validBits = bits;
      if (format === 0xfffe) {
        if (size < 40 || fmt.u16(16, true) < 22) throw new Error("Short extensible WAV fmt");
        validBits = fmt.u16(18, true) || bits;
        if (!fmt.slice(26, 14).every((value, index) => value === [0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113][index]))
          throw new Error("Unsupported WAV subformat GUID");
        format = fmt.u16(24, true);
      }
      hasFmt = true;
    } else if (type === "data") { dataSize += size; hasData = true; }
    else if (type === "fact" && size < 4) throw new Error("Short WAV fact");
    else if (type === "bext" && size < 602) throw new Error("Short Broadcast Wave extension");
    else if (type === "LIST" && size >= 4 && (await read(start, 4)).text(0, 4) === "INFO") {
      for (let pos = start + 4; pos < start + size;) {
        const info = await read(pos, 8), id = info.text(0, 4), length = info.u32(4, true);
        if (length > start + size - pos - 8) throw new Error("WAV INFO exceeds LIST bounds");
        if (options.onTag) {
          await options.onTag({ key: infoNames[id] ?? id, offset: pos + 8, length });
          options.signal?.throwIfAborted();
          pos += 8 + length + length % 2;
          continue;
        }
        const decoder = new TextDecoder(); let text = "", ended = false;
        for (let index = 0; index < length; index += 16384) {
          const part = decoder.decode((await read(pos + 8 + index, Math.min(16384, length - index))).bytes, { stream: true });
          if (!ended) { const zero = part.indexOf("\0"); text += zero < 0 ? part : part.slice(0, zero); ended = zero >= 0; }
        }
        const tail = decoder.decode();
        tags[infoNames[id] ?? id] = cleanText(text + (ended ? "" : tail));
        pos += 8 + length + length % 2;
      }
    }
    offset = start + size + size % 2;
    if (offset > end) throw new Error("Missing WAV chunk padding");
  }
  if (!hasFmt || !hasData) throw new Error("WAV requires fmt and data");
  const stream = wavStream({ format, sampleRate, channels, bits, validBits, align, dataSize });
  return { format: "wav", streams: [stream], tags, duration: stream.duration, bitrate: stream.duration ? source.size * 8 / stream.duration : 0 };
}
