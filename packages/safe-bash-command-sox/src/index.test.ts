import { it, expect } from "vitest";
import { processAudio } from "./process.js";
import { encodeWav, decodePcm } from "@poe-code/audio-ast";
const wav = encodeWav({
  sampleRate: 8000,
  channels: [Float64Array.from({ length: 800 }, (_, i) => Math.sin(i) * 0.25)]
});
it("trims, pads, normalizes, resamples and remixes PCM", () => {
  const result = processAudio(
    [wav],
    ["trim", "0.02", "0.04", "pad", "0.01", "0.01", "norm", "-3", "rate", "4000", "channels", "2"],
    {},
    { maxSamples: 10000 }
  );
  const pcm = decodePcm(result.bytes!);
  expect(pcm.sampleRate).toBe(4000);
  expect(pcm.channels).toHaveLength(2);
  expect(pcm.channels[0]).toHaveLength(240);
});
it("synthesizes bounded null input and reports analysis", () => {
  const result = processAudio(
    [],
    ["synth", "0.1", "sine", "440", "stat"],
    { rate: 8000 },
    { maxSamples: 10000 }
  );
  expect(decodePcm(result.bytes!).channels[0]).toHaveLength(800);
  expect(result.stderr).toContain("RMS");
  expect(() =>
    processAudio([], ["synth", "100000", "sine", "440"], {}, { maxSamples: 10000 })
  ).toThrow(/limit/);
});
it("reverse and gain -n compose without modifying source", () => {
  const before = wav.slice();
  const out = processAudio([wav], ["reverse", "gain", "-n"], {}, { maxSamples: 10000 });
  expect(out.bytes).toBeDefined();
  expect(wav).toEqual(before);
});

it("bounds cumulative DSP work before expensive resampling", () => {
  expect(() =>
    processAudio([wav], ["rate", "1"], {}, { maxSamples: 10000, maxWorkSamples: 100 })
  ).toThrow(/work limit/);
  expect(() =>
    processAudio([wav], ["reverse", "reverse"], {}, { maxSamples: 10000, maxWorkSamples: 1000 })
  ).toThrow(/work limit/);
});

it("fade-in alone preserves the end of the audio", () => {
  const source = encodeWav({ sampleRate: 8000, channels: [new Float64Array(800).fill(0.5)] });
  const result = processAudio([source], ["fade", "0.01"], {}, { maxSamples: 10000 });
  expect(decodePcm(result.bytes).channels[0]!.at(-1)).toBeCloseTo(0.5, 3);
});
