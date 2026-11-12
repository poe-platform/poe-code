import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { headphoneAudio } from "./audio-headphone.js";
import { createFfmpegCommand } from "./index.js";

// Linux FFmpeg 7.0.2-static, each mode compared with its own native output.
const native = {
  time: "f697fa3c00000000562e013df6977a3caf63243d54d4bf3ca23e293ddca7c53c93192e3d657bcb3c86f4323ded4ed13c78cf373d7622d73c69aa3c3dfef5dc3c5a85413d87c9e23c4c60463d109de83c3e3b4b3d9870ee3c2f16503d2144f43c",
  freq: "f697fa3c000077af562e013df6977a3caf63243d54d4bf3ca23e293ddca7c53c94192e3d647bcb3c86f4323ded4ed13c76cf373d7622d73c68aa3c3dfef5dc3c5a85413d86c9e23c4c60463d0f9de83c3e3b4b3d9870ee3c2e16503d2044f43c"
};
async function render(type: string, format: string, length: number, taps: number, size: number, gain: number) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from({ length }, (_, i) => (5000 + (i * 71) % 10000) / 32768),
    Float64Array.from({ length }, (_, i) => (-1000 + (i * 53) % 8000) / 32768)
  ] }));
  volume.writeFileSync("/ir.wav", encodeWav({ sampleRate: 8000, channels: [
    taps === 3 ? Float64Array.from([16384, 0, 4096], x => x / 32768)
      : Float64Array.from({ length: taps }, (_, i) => ((i * 157) % 4096 - 2048) / 32768),
    taps === 3 ? Float64Array.from([0, 8192, 4096], x => x / 32768)
      : Float64Array.from({ length: taps }, (_, i) => ((i * 113) % 4096 - 2048) / 32768)
  ] }));
  const output: Uint8Array[] = [], errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", "-i", "/ir.wav", "-i", "/ir.wav",
      "-filter_complex", `[0:a][1:a][2:a]headphone=map=FL|FR:type=${type}:size=${size}:gain=${gain}[o]`,
      "-map", "[o]", "-f", format, "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(data: Uint8Array) { output.push(data); } },
    stderr: { async write(data: Uint8Array) { errors.push(data); } }
  } as never);
  assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
  assert.equal(Buffer.concat(errors).toString(), "");
  return Buffer.concat(output);
}

for (const type of ["time", "freq"] as const) {
  for (const format of ["f32le", "s16le"]) {
    it(`headphone ${type} matches native ${format} samples`, async () => {
      const pcm = await render(type, format, 12, 3, 1024, 0);
      assert.equal(pcm.toString("hex"), format === "f32le" ? native[type]
        : "ea0300000904f5012305ff024a05170371052e0398054503be055d03e50574030c068b033306a2035a06ba038106d103");
    });
  }
  for (const reference of [
    { length: 81, size: 1024, gain: 0,
      time: "b2733eb4ecc3b0d2724cb7af749fe3494feb35b6f89e04a24d84b94e58c030b2",
      freq: "5a5b66ee6455e2fd8a1675ebe770c34d8e081c23dab217bfb6025bb4d929eaf9" },
    { length: 2400, size: 1024, gain: 0,
      time: "17b73b85ac24491aa3f8821279073ed67e030d5556b5b76b53ff4e45a0e184a3",
      freq: "b31690af862fd0d9bb46687090d1814fb0cac6c32eb811cb5e89796c8a0c9501" },
    { length: 2400, size: 2048, gain: 0,
      time: "17b73b85ac24491aa3f8821279073ed67e030d5556b5b76b53ff4e45a0e184a3",
      freq: "5511ba556c16e61768d7aac3cacaa699e277f47ed2a9ec7da3587bd7fe2a910f" },
    { length: 81, size: 1024, gain: 6,
      time: "efe634b7cb8f6374789838e2f09b27a07548c10a00145cc17de1399c70dadd48",
      freq: "105f80b05644c92eff844cce34fe18dc2844941cdc1645295a6e6e018419f642" }
  ]) {
    it(`headphone ${type} matches native float32 with 37 taps, length=${reference.length}, size=${reference.size}, gain=${reference.gain}`, async () => {
      const pcm = await render(type, "f32le", reference.length, 37, reference.size, reference.gain);
      assert.equal(pcm.length, reference.length * 2 * 4);
      assert.equal(createHash("sha256").update(pcm).digest("hex"), reference[type]);
    });
  }
}

for (const type of ["time", "freq"]) {
  it(`headphone ${type} bounds convolution memory, CPU, and cancellation`, async () => {
    const track = parseWav(encodeWav({ sampleRate: 8000,
      channels: [new Float64Array(12), new Float64Array(12)] })).tracks[0]!;
    const tracks = [track, track, track];
    const filter = `headphone=map=FL|FR:type=${type}`;
    const filterAudio = async () => { assert.fail("Stereo responses need no layout conversion"); };
    await assert.rejects(headphoneAudio(tracks, filter, filterAudio, new MediaBudgetTracker({ maxMemoryBytes: 192 })), /maxMemoryBytes/);
    await assert.rejects(headphoneAudio(tracks, filter, filterAudio, new MediaBudgetTracker({ maxCpuMs: -1 })), /maxCpuMs/);
    await assert.rejects(headphoneAudio(tracks, filter, filterAudio, new MediaBudgetTracker(), AbortSignal.abort()), { name: "AbortError" });
  });
}
