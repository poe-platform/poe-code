import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete PCM16 output from native Linux FFmpeg 7.0.2.
const cases = [
  ["pan=FC+BC|c0=c0|c1=c1,anull", [-1000, 0, -910, 0, -820, 0, -730, 0]],
  ["pan=FC+BC|c0=c0|c1=c1,stereotools", [-707, -707, -643, -643, -580, -580, -516, -516]],
  ["pan=FC+BC|c0=c0|c1=c1,stereowiden", [-354, -354, -322, -322, -290, -290, -258, -258]],
  ["pan=FC+BC|c0=c0|c1=c1,extrastereo", [-707, -707, -643, -643, -580, -580, -516, -516]],
  ["pan=FC+BC|c0=c0|c1=c1,crossfeed", [-636, -636, -579, -579, -522, -522, -465, -465]],
  ["channelmap=0|1:FC+BC,stereotools", [-793, -793, -686, -686, -579, -579, -471, -471]],
  ["channelmap=0|1:FC+BC,stereowiden", [-396, -396, -343, -343, -289, -289, -236, -236]],
  ["channelmap=0|1:FC+BC,extrastereo", [-793, -793, -686, -686, -579, -579, -471, -471]],
  ["channelmap=0|1:FC+BC,crossfeed", [-714, -714, -617, -617, -521, -521, -424, -424]],
  ["pan=FC+LFE|c0=c0|c1=c1,stereotools", [-707, -707, -643, -643, -580, -580, -516, -516]],
  ["pan=FL+FR|c0=c0|c1=c1,extrastereo", [4000, -6000, 4072, -5892, 4145, -5785, 4218, -5678]]
] as const;

for (const graph of [false, true]) {
  for (const [filter, expected] of cases) {
    it(`mixes center speakers before ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from({ length: 4 }, (_, i) => (1000 + i * 83) / 32768),
        Float64Array.from({ length: 4 }, (_, i) => (-3000 + i * 97) / 32768)
      ] });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const output = Buffer.concat(stdout);
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
    });
  }
}

for (const graph of [false, true]) {
  for (const [effect, expected] of [
    ["stereotools", "9e4a04be9e4a04be8cdd003f8cdd003f66786dbe66786dbe01e3ebbe01e3ebbe"],
    ["stereowiden", "9e4a84bd9e4a84bd8cdd803e8cdd803e6578edbd6578edbd02e36bbe02e36bbe"],
    ["extrastereo", "9e4a04be9e4a04be8cdd003f8cdd003f66786dbe66786dbe01e3ebbe01e3ebbe"],
    ["crossfeed", "e81feebde81feebd2ff5e73e2ff5e73e28b955be28b955be4e4cd4be4e4cd4be"]
  ]) {
    it(`mixes double center speakers before ${effect} (graph=${graph})`, async () => {
      const input = Buffer.alloc(64);
      [0.123456789, -0.34567891, 0.77777777, 0.456789123, -0.987654321, 0.23456789, 0.111111111, -0.999999999]
        .forEach((sample, i) => input.writeDoubleLE(sample, i * 8));
      const volume = Volume.fromJSON({ "/in.pcm": input });
      const filter = `pan=FC+BC|c0=0.5*c0|c1=c1,${effect}`;
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "f64le", "-ar", "8000", "-ac", "2", "-i", "/in.pcm", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "f32le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.equal(Buffer.concat(stdout).toString("hex"), expected);
    });
  }
}
