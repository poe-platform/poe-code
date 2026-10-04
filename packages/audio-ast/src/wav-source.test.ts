import { expect, it } from "vitest";
import { encodeWav, parseAudio, probeWavSource } from "./index.js";
import { join, ascii, uint32 } from "./binary.js";
import { riffChunk } from "./wav.js";

const wav = () => encodeWav({ sampleRate: 8000, channels: [new Float64Array([0, .5, -.5, 0])] }, { tags: { title: "title", artist: "artist" } });
const source = (bytes: Uint8Array) => ({ size: bytes.length, async read(offset: number, length: number) { expect(length).toBeLessThanOrEqual(16384); return bytes.slice(offset, offset + length); } });

it("preserves the strict audio schema without reading sample payloads", async () => {
  const bytes = wav(), reference = parseAudio(bytes);
  const result = await probeWavSource({ size: bytes.length, async read(offset, length) {
    for (const node of reference.nodes.filter(n => n.type === "data")) expect(offset + length <= node.offset + 8 || offset >= node.offset + node.size).toBe(true);
    return bytes.slice(offset, offset + length);
  } });
  const { format, streams, tags, duration, bitrate } = reference;
  expect(result).toEqual({ format, streams, tags, duration, bitrate });
});

it("counts multiple data chunks and validates strict RIFF boundaries", async () => {
  const bytes = wav(), extra = riffChunk("data", new Uint8Array(8));
  const combined = join([bytes, extra]); new DataView(combined.buffer).setUint32(4, combined.length - 8, true);
  expect(await probeWavSource(source(combined))).toMatchObject({ streams: [{ samples: 8 }] });
  for (const change of [ (b: Uint8Array) => new DataView(b.buffer).setUint32(4, b.length, true), (b: Uint8Array) => new DataView(b.buffer).setUint16(32, 7, true) ]) {
    const invalid = bytes.slice(); change(invalid);
    let expected: unknown; try { parseAudio(invalid); } catch (error) { expected = error; }
    expect(expected).toBeInstanceOf(Error);
    await expect(probeWavSource(source(invalid))).rejects.toThrow((expected as Error).message);
  }
});

it("skips large unknown and broadcast histories while reading metadata in bounded pieces", async () => {
  const bytes = wav(), ast = parseAudio(bytes), fmt = ast.nodes.find(n => n.type === "fmt ")!;
  const tag = riffChunk("INAM", new TextEncoder().encode("x".repeat(40000) + "\0"));
  const chunks = join([riffChunk("fmt ", fmt.data), riffChunk("bext", new Uint8Array(50000)), riffChunk("LIST", join([ascii("INFO"), tag])), riffChunk("data", new Uint8Array(8))]);
  const input = join([ascii("RIFF"), uint32(chunks.length + 4, true), ascii("WAVE"), chunks]);
  const result = await probeWavSource(source(input));
  expect(result.tags.title).toBe("x".repeat(40000));
});

it("propagates cancellation and retained read errors", async () => {
  const controller = new AbortController(); controller.abort(new Error("cancelled source"));
  await expect(probeWavSource(source(wav()), { signal: controller.signal })).rejects.toThrow("cancelled source");
  await expect(probeWavSource({ size: 44, async read() { throw new Error("remote read failed"); } })).rejects.toThrow("remote read failed");
});

for (const options of [{ bitsPerSample: 8 }, { bitsPerSample: 24 }, { bitsPerSample: 32 }, { bitsPerSample: 32, float: true }, { bitsPerSample: 64, float: true }] as const)
  it(`preserves ${options.bitsPerSample}-bit PCM/float timing`, async () => {
    const bytes = encodeWav({ sampleRate: 44100, channels: [new Float64Array([0, .25]), new Float64Array([-.5, .5])] }, options);
    const { format, streams, tags, duration, bitrate } = parseAudio(bytes);
    expect(await probeWavSource(source(bytes))).toEqual({ format, streams, tags, duration, bitrate });
  });

it("preserves extensible precision and rejects invalid GUIDs", async () => {
  const fmt = new Uint8Array(40), view = new DataView(fmt.buffer);
  view.setUint16(0, 0xfffe, true); view.setUint16(2, 1, true); view.setUint32(4, 8000, true);
  view.setUint32(8, 32000, true); view.setUint16(12, 4, true); view.setUint16(14, 32, true);
  view.setUint16(16, 22, true); view.setUint16(18, 24, true);
  fmt.set([1, 0, 0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113], 24);
  const chunks = join([riffChunk("fmt ", fmt), riffChunk("fact", uint32(1, true)), riffChunk("data", new Uint8Array(4))]);
  const bytes = join([ascii("RIFF"), uint32(chunks.length + 4, true), ascii("WAVE"), chunks]);
  const { format, streams, tags, duration, bitrate } = parseAudio(bytes);
  expect(await probeWavSource(source(bytes))).toEqual({ format, streams, tags, duration, bitrate });
  bytes[20 + 30] = 0;
  await expect(probeWavSource(source(bytes))).rejects.toThrow("Unsupported WAV subformat GUID");
});
