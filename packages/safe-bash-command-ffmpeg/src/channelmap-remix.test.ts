import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [1000, 9000, 2000, -6000, -3000, 3000];
const wav = encodeWav({ sampleRate: 8000, channels: [
  Float64Array.from([1000, 2000, -3000], sample => sample / 32768),
  Float64Array.from([9000, -6000, 3000], sample => sample / 32768)
] });

// FFmpeg 7.0.2 exits with EINVAL (234) and no PCM for unsupported remixes.
for (const [layout, conversion, outputArgs, expected, exitCode] of [
  ["FR+FL", "", ["-ac", "2"], [], 234],
  ["FR+FL", ",aformat=channel_layouts=mono", [], [], 234],
  ["FR+FL", ",aresample=ochl=mono", [], [], 234],
  ["FR+FR", "", ["-ac", "1"], [], 234],
  ["FC@Voice+LFE@Sub", "", ["-ac", "1"], [], 234],
  ["FR+FL", "", [], samples, 0],
  ["stereo", "", ["-ac", "2"], samples, 0],
  ["BL+BR", "", ["-ac", "2"], [], 234],
  ["FR+FR", "", [], samples, 0],
  ["FC@Voice+LFE@Sub", "", [], samples, 0],
  ["2C", "", ["-ac", "2"], samples, 0],
  ["FR+FL", ",aformat=channel_layouts=stereo", [], [], 234],
  ["FC@Voice+LFE@Sub", ",aresample=ochl=stereo", [], [], 234],
  ["FR+FL", ",channelmap=0|1:stereo", ["-ac", "2"], samples, 0]
] as const) {
  for (const complex of [false, true]) {
    it(`matches custom-layout remix status and PCM (${complex ? "graph" : "simple"}): ${layout}${conversion} ${outputArgs.join(" ")}`, async () => {
      const volume = new Volume();
      volume.writeFileSync("/in.wav", wav);
      const stdout: Buffer[] = [];
      let stderr = "";
      const filter = `channelmap=map=0|1:channel_layout=${layout}${conversion}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          ...outputArgs, "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, exitCode, stderr);
      const output = Buffer.concat(stdout);
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)), expected);
    });
  }
}
