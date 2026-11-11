import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const left = [0, 8192, 16384, 24576, 32767, 24576, 16384, 8192, 0, -8192, -16384, -24576, -32768, -24576, -16384, -8192];
const right = left.map(() => 4096);
for (const [expression, expected] of [
  ["i=2", [[0,24576,32767,32767,32767,8194,0,-8192,-16384,-24576,-32768,-32768,-32768,-8192,0,8192], [12288, ...right.slice(1)]]],
  ["", [[0,24576,32767,32767,32767,8194,0,-8192,-16384,-24576,-32768,-32768,-32768,-8192,0,8192], [12288, ...right.slice(1)]]],
  ["0", [left, right]],
  ["2:0,volume=0.5", [[0,12288,16384,20480,24574,4097,0,-4096,-8192,-12288,-16384,-20480,-24576,-4096,0,4096], [6144, ...right.slice(1).map(x => x / 2)]]],
  ["i=-1", [[0,4096,10240,17408,25088,24832,20608,14400,7200,-496,-8440,-16508,-24638,-24607,-20496,-14344], [2048,3072,3584,3840,3968,4032,4064,4080,4088,4092,4094,4095,4096,4096,4096,4096]]],
  ["i=NaN", 234],
  ["i=11", 222],
  ["i=-11", 222],
  ["c=invalid", 234],
  ["unknown=1", 8]
] as const) {
  for (const channels of [1, 2]) {
    for (const complex of [false, true]) {
      it(`crystalizes successive PCM samples (${channels} channels, ${complex ? "graph" : "simple"}): ${expression}`, async () => {
        const repetitions = expression === "i=2" ? 500 : 1;
        const volume = Volume.fromJSON({ "/out.wav": "existing" });
        volume.writeFileSync("/twins.wav", encodeWav({ sampleRate: 8000,
          channels: [left, right].slice(0, channels).map(samples => Float64Array.from(Array.from({ length: repetitions }, () => samples).flat(), sample => sample / 32768)) }));
        let stderr = "";
        const filters = complex
          ? ["-filter_complex", `[0:a]crystalizer${expression ? `=${expression}` : ""}[s]`, "-map", "[s]"]
          : ["-af", `crystalizer${expression ? `=${expression}` : ""}`];
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/twins.wav", ...filters, "/out.wav"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (typeof expected === "number") {
          assert.equal(result.exitCode, expected, stderr);
          assert.ok(stderr.includes("crystalizer:"), stderr);
          assert.equal(volume.readFileSync("/out.wav", "utf8"), "existing");
          return;
        }
        assert.equal(result.exitCode, 0, stderr);
        const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        assert.equal(audio.channels, channels);
        assert.equal(audio.sampleRate, 8000);
        const expectedChannels = expected.slice(0, channels).map((samples, channel) =>
          Array.from({ length: repetitions }, (_, repeat) => repeat === 0 ? samples
            : [channel === 0 ? 16384 : 4096, ...samples.slice(1)]).flat());
        assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), expectedChannels);
      });
    }
  }
}

// Native FFmpeg 7.0.2 statuses for the same eight-sample raw PCM input.
for (const [filter, exitCode] of [
  ["crystalizer=i=20", 222],
  ["crystalizer=c=invalid", 234],
  ["crystalizer=i=not_a_number", 234],
  ["crystalizer=unknown=1", 8],
  ["crystalizer=i=0", 0]
] as const) {
  for (const complex of [false, true]) {
    it(`${filter} returns status ${exitCode} without creating output on failure (${complex ? "graph" : "simple"})`, async () => {
      const input = Buffer.from("00100020003000400050006000700040", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input });
      let stderr = "";
      const filters = complex
        ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"]
        : ["-af", filter];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw", ...filters, "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, exitCode, stderr);
      if (exitCode === 0) assert.deepEqual(volume.readFileSync("/out.raw"), input);
      else assert.equal(volume.existsSync("/out.raw"), false);
    });
  }
}
