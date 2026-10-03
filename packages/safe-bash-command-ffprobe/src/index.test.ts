import { describe, it, expect } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { probe } from "./probe.js";
const wav = encodeWav({ sampleRate: 8000, channels: [new Float64Array(800)] });
describe("audio ffprobe", () => {
  it("reports native numeric/string schema", () => {
    const result = JSON.parse(
      probe(wav, ["-v", "quiet", "-of", "json", "-show_streams", "-show_format", "tone.wav"])
    );
    expect(result.streams[0]).toMatchObject({
      codec_name: "pcm_s16le",
      codec_type: "audio",
      sample_rate: "8000",
      channels: 1,
      bits_per_sample: 16,
      duration: "0.100000",
      bit_rate: "128000"
    });
    expect(result.format).toMatchObject({
      filename: "tone.wav",
      format_name: "wav",
      duration: "0.100000",
      size: String(wav.length)
    });
  });
  it.each(["json", "compact", "csv", "default", "flat"])(
    "filters entries using %s writer",
    (writer) => {
      const result = probe(wav, [
        "-of",
        writer,
        "-show_entries",
        "stream=sample_rate,channels:format=duration",
        "-select_streams",
        "a:0",
        "-i",
        "tone.wav"
      ]);
      expect(result).toContain("8000");
      expect(result).not.toContain("codec_name");
      expect(result).toContain("0.100000");
    }
  );
  it("rejects missing values and unknown flags", () => {
    expect(() => probe(wav, ["-of"])).toThrow();
    expect(() => probe(wav, ["-wat", "x"])).toThrow();
  });
});

it("uses codec precision and integer rates in the ffprobe schema", () => {
  const flac = new Uint8Array(42);
  flac.set(new TextEncoder().encode("fLaC"));
  flac.set([128, 0, 0, 34], 4);
  new DataView(flac.buffer).setBigUint64(18, (48000n << 44n) | (15n << 36n) | 12000n);
  const result = JSON.parse(probe(flac, ["-show_streams", "-of", "json", "x.flac"]));
  expect(result.streams[0].bits_per_sample).toBe(0);
  expect(result.streams[0]).not.toHaveProperty("bit_rate");
  const mp3 = new Uint8Array(834);
  mp3.set([255, 251, 144, 0]);
  mp3.set([255, 251, 144, 0], 417);
  const stream = JSON.parse(probe(mp3, ["-show_streams", "-of", "json", "x.mp3"])).streams[0];
  expect(Number.isInteger(Number(stream.bit_rate))).toBe(true);
});
