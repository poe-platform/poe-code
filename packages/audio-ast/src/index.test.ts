import { describe, it, expect } from "vitest";
import {
  encodeWav,
  decodePcm,
  parseAudio,
  probeAudio,
  transformAudio,
  stats,
  concat
} from "./index.js";

describe("PCM audio", () => {
  for (const bitsPerSample of [8, 16, 24, 32] as const)
    it(`round trips ${bitsPerSample}-bit PCM with metadata`, () => {
      const pcm = { sampleRate: 8000, channels: [Float64Array.from([-1, -0.5, 0, 0.5, 0.99])] };
      const bytes = encodeWav(pcm, { bitsPerSample, tags: { title: "Signal", artist: "Artist" } });
      const ast = parseAudio(bytes);
      expect(ast.format).toBe("wav");
      expect(ast.tags.title).toBe("Signal");
      expect(probeAudio(bytes).streams[0]?.sampleRate).toBe(8000);
      const decoded = decodePcm(bytes);
      decoded.channels[0]!.forEach((v, i) =>
        expect(v).toBeCloseTo(pcm.channels[0]![i]!, bitsPerSample === 8 ? 1 : 4)
      );
    });
  for (const bitsPerSample of [32, 64] as const)
    it(`round trips float${bitsPerSample}`, () => {
      const pcm = { sampleRate: 48000, channels: [Float64Array.from([0.123, -0.75])] };
      expect(
        Array.from(decodePcm(encodeWav(pcm, { bitsPerSample, float: true })).channels[0]!)
      ).toEqual(expect.arrayContaining([expect.closeTo(0.123, 6), -0.75]));
    });
  it("composes trim, pad, remix, rate, normalize and fade without mutating input", () => {
    const pcm = {
      sampleRate: 4,
      channels: [Float64Array.from([1, 1, 1, 1]), Float64Array.from([0, 0, 0, 0])]
    };
    const result = transformAudio(pcm, [
      { type: "trim", startSec: 0.25, durationSec: 0.5 },
      { type: "pad", leadSec: 0.25, trailSec: 0.25 },
      { type: "channels", channels: 1 },
      { type: "rate", sampleRate: 8, method: "linear" },
      { type: "normalize", targetDb: -6 },
      { type: "fade", inSec: 0.25, outSec: 0.25 }
    ]);
    expect(result.channels).toHaveLength(1);
    expect(result.channels[0]).toHaveLength(8);
    expect(result.channels[0]![0]).toBe(0);
    expect(result.channels[0]![7]).toBe(0);
    expect(pcm.channels[0]![0]).toBe(1);
  });
  it("sinc resampling preserves DC and suppresses frequencies above output Nyquist", () => {
    const constant = { sampleRate: 100, channels: [new Float64Array(100).fill(0.5)] };
    const result = transformAudio(constant, [{ type: "rate", sampleRate: 50, method: "sinc" }]);
    expect(result.channels[0]![20]).toBeCloseTo(0.5, 8);
    const tone = {
      sampleRate: 100,
      channels: [
        Float64Array.from({ length: 200 }, (_, i) => Math.sin((2 * Math.PI * 40 * i) / 100))
      ]
    };
    const low = transformAudio(tone, [{ type: "rate", sampleRate: 50, method: "sinc" }]);
    expect(Math.max(...low.channels[0]!.slice(20, 80).map(Math.abs))).toBeLessThan(0.03);
  });
  it("computes statistics and concatenates compatible buffers", () => {
    const pcm = { sampleRate: 4, channels: [Float64Array.from([-0.5, 0.5, -0.5, 0.5])] };
    expect(stats(pcm)).toMatchObject({ dcOffset: 0, zeroCrossings: 3, crestFactor: 1 });
    expect(stats(pcm).peakDbfs).toBeCloseTo(-6.0206, 4);
    expect(concat([pcm, pcm]).channels[0]).toHaveLength(8);
    expect(() => concat([pcm, { ...pcm, sampleRate: 8 }])).toThrow();
  });
  it("rejects truncated, inconsistent and unsupported input", () => {
    const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(2)] });
    expect(() => parseAudio(bytes.subarray(0, bytes.length - 1))).toThrow();
    expect(() => parseAudio(new Uint8Array(20))).toThrow();
    expect(() =>
      transformAudio({ sampleRate: 1, channels: [new Float64Array(1)] }, [
        { type: "rate", sampleRate: 0 }
      ])
    ).toThrow();
  });
});
