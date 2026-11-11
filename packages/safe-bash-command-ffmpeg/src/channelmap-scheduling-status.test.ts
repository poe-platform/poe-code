import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [option, exitCode, diagnostic] of [
  ["threads=-1", 222, "invalid threads"],
  ["extra_hw_frames=-2", 222, "invalid extra_hw_frames"],
  ["thread_type=1.5", 222, "invalid thread_type"],
  ["threads=oops", 234, "invalid or unsupported expression"],
  ["threads=(1", 234, "invalid expression"],
  ["bogus=1", 8, "unsupported option bogus"],
  ["threads=1", 0, ""]
] as const) {
  for (const complex of [false, true]) {
    it(`returns channelmap scheduling status and PCM (${complex ? "graph" : "simple"}): ${option}`, async () => {
      const input = encodeWav({
        sampleRate: 8000,
        channels: [[100, 200, -300, -400], [1000, -2000, 3000, -4000]]
          .map(samples => Float64Array.from(samples, sample => sample / 32768))
      });
      const volume = Volume.fromJSON({ "/pair.wav": Buffer.from(input) });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const filter = `channelmap=${option}:map=1|0`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/pair.wav",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
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
      assert.equal(result.exitCode, exitCode, stderr);
      assert.equal(Buffer.concat(stdout).toString("hex"), exitCode === 0 ? "e803640030f8c800b80bd4fe60f070fe" : "");
      assert.equal(stderr, diagnostic ? `ffmpeg: channelmap: ${diagnostic}\n` : "");
      assert.deepEqual(volume.readFileSync("/pair.wav"), Buffer.from(input));
      assert.deepEqual(volume.readdirSync("/"), ["pair.wav"]);
    });
  }
}
