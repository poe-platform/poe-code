import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const channels = [[1000, 2000, 3000, 4000], [-4000, -3000, -2000, -1000]];

// Native FFmpeg 7.0.2 offsets for this four-frame, 8 kHz stereo PCM16 input.
for (const [filter, offsets] of [
  ["adelay", [0, 0]],
  ["adelay=", [0, 0]],
  ["adelay=all=1", [0, 0]],
  ["adelay=|1S", [1, 0]],
  ["adelay=2S||1S", [2, 1]],
  ["adelay=2S|", [2, 0]],
  ["adelay=2S||:all=1", [2, 2]],
  ["adelay=0", [0, 0]],
  ["adelay=2S|1S", [2, 1]]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} preserves native channel delays (${graph ? "graph" : "simple"})`, async () => {
      const volume = new Volume();
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: channels.map(channel => Float64Array.from(channel, value => value / 32768)) }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channelData.length, 2);
      for (const [channel, samples] of channels.entries()) {
        assert.deepEqual(Array.from(audio.channelData[channel]!, value => Math.round(value * 32768)), [
          ...new Array<number>(offsets[channel]!).fill(0), ...samples,
          ...new Array<number>(Math.max(...offsets) - offsets[channel]!).fill(0)
        ]);
      }
    });
  }
}

// Native FFmpeg 7.0.2 keeps empty-list filters in passthrough mode after updates,
// but still emits the requested tail. An explicit zero initializes delay buffers.
for (const [delay, command, expected] of [
  ["", true, "e15a7fb6cecf8a72c1dc5962f63389f7391843ae20a521c19ed504872331da4f"],
  ["=0S", true, "485de0c166469a6d073ce3acee90798d66ca68d04f41902eac2206090c85ad19"],
  ["", false, "31430f6cc9a88992e6fad622e45f7598a129df401155afa43991bf381c132446"]
] as const) {
  for (const graph of [false, true]) {
    it(`empty-list scheduled delay ${delay}, command=${command}, graph=${graph}`, async () => {
      const volume = new Volume();
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 32 }, (_, i) => (100 + i) / 32768),
          Float64Array.from({ length: 32 }, (_, i) => (-200 - i) / 32768)] }));
      const filter = `asetnsamples=8:0,${command ? "asendcmd=c='0.002 adelay@d delays 5S'," : ""}adelay@d${delay}`;
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "-"],
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
      const output = Buffer.concat(stdout);
      assert.equal(output.length / 4, command ? 37 : 32);
      assert.equal(createHash("sha256").update(output).digest("hex"), expected);
    });
  }
}
