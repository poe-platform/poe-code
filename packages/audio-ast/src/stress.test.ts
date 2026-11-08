import { expect, it } from "vitest";
import { decodePcm, encodeWav, parseAudio, stats, transformAudio } from "./index.js";
import { ascii, join, uint32, Reader } from "./binary.js";
import { riffChunk } from "./wav.js";
import { encodeId3, parseId3 } from "./id3.js";

it("rejects every truncated MPEG frame without scanning beyond the input", () => {
  const frame = new Uint8Array(417);
  frame.set([255, 251, 144, 0]);
  for (let length = 0; length < frame.length; length++) {
    expect(() => parseAudio(frame.subarray(0, length)), `prefix ${length}`).toThrow();
  }
  expect(parseAudio(frame).streams[0]?.samples).toBe(1152);
});
it("bounds malformed ID3 tag, extended-header and unsynchronized frame sizes", () => {
  for (const version of [3, 4]) {
    for (const size of [0, 1, 3, 0x7fffffff, 0xffffffff]) {
      const tag = new Uint8Array(24);
      tag.set(ascii("ID3"));
      tag.set([version, 0, 64, 0, 0, 0, 14], 3);
      new DataView(tag.buffer).setUint32(10, size);
      expect(() => parseId3(tag), `${version}/${size}`).toThrow();
    }
  }
  const tag = encodeId3({ title: "Aÿá" });
  for (let length = 0; length < tag.length; length++) {
    expect(() => parseId3(tag.subarray(0, length))).toThrow();
  }
  const corrupt = tag.slice();
  corrupt[5] = 128;
  corrupt[17] = 127;
  expect(() => parseId3(corrupt)).toThrow();
});
it("uses unsigned multi-gigabyte header arithmetic without allocating payloads", () => {
  const wav = encodeWav({ sampleRate: 8000, channels: [new Float64Array(0)] });
  for (const size of [0x7fffffff, 0x80000000, 0xfffffffe]) {
    const bytes = wav.slice();
    new DataView(bytes.buffer).setUint32(4, size, true);
    expect(new Reader(bytes).u32(4, true)).toBe(size);
    expect(() => parseAudio(bytes)).toThrow();
  }
  const info = new Uint8Array(34);
  const samples = (1n << 36n) - 1n;
  new DataView(info.buffer).setBigUint64(10, (48000n << 44n) | (15n << 36n) | samples);
  const flac = join([ascii("fLaC"), new Uint8Array([128, 0, 0, 34]), info]);
  expect(parseAudio(flac).streams[0]?.samples).toBe(Number(samples));
  expect(parseAudio(flac).duration).toBe(Number(samples) / 48000);
});
it("ignores arbitrary RIFF pad byte values and retains odd unknown chunks", () => {
  const wav = encodeWav(
    { sampleRate: 8000, channels: [Float64Array.of(0.25)] },
    { bitsPerSample: 8 }
  );
  for (const padding of [0, 1, 127, 255]) {
    const chunk = riffChunk("JUNK", Uint8Array.of(42));
    chunk[chunk.length - 1] = padding;
    const body = join([ascii("WAVE"), chunk, wav.subarray(12)]);
    const bytes = join([ascii("RIFF"), uint32(body.length, true), body]);
    expect(decodePcm(bytes).channels[0]).toEqual(Float64Array.of(0.25));
    expect(parseAudio(bytes).nodes[0]?.data).toEqual(Uint8Array.of(42));
  }
});
it("handles zero-sample PCM through every supported precision and DSP effect", () => {
  for (const bitsPerSample of [8, 16, 24, 32] as const) {
    for (const float of bitsPerSample === 32 ? [false, true] : [false]) {
      const pcm = decodePcm(
        encodeWav({ sampleRate: 48000, channels: [new Float64Array()] }, { bitsPerSample, float })
      );
      expect(stats(pcm)).toMatchObject({ peak: 0, rms: 0 });
      const result = transformAudio(pcm, [
        { type: "trim", startSec: 0 },
        { type: "rate", sampleRate: 16000 },
        { type: "channels", channels: 2 },
        { type: "normalize", targetDb: -3 },
        { type: "fade", inSec: 0, outSec: 0 }
      ]);
      expect(result.channels.map((channel) => channel.length)).toEqual([0, 0]);
    }
  }
});

it("accepts the minimum valid ID3 extended headers before text frames", () => {
  const base = encodeId3({ title: "Title" });
  for (const version of [3, 4]) {
    const extended = new Uint8Array(version === 3 ? 10 : 6);
    new DataView(extended.buffer).setUint32(0, 6);
    if (version === 4) extended[4] = 1;
    const bytes = join([base.subarray(0, 10), extended, base.subarray(10)]);
    bytes[3] = version;
    bytes[5] = 64;
    bytes[9] = bytes.length - 10;
    expect(parseId3(bytes).tags.title).toBe("Title");
  }
});
