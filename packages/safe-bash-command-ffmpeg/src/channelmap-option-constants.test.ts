import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const option of [
  "threads=default", "threads=min", "extra_hw_frames=default", "extra_hw_frames=min",
  "thread_type=none", "thread_type=all", "thread_type=default",
  "threads=1", "thread_type=slice"
]) {
  for (const complex of [false, true]) {
    it(`swaps channels with ${option} (${complex ? "graph" : "simple"})`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from([100, 200, -300, -400], value => value / 32768),
        Float64Array.from([1000, -2000, 3000, -4000], value => value / 32768)
      ] });
      const volume = Volume.fromJSON({ "/pair.wav": Buffer.from(input) });
      const filter = `channelmap=${option}:map=1|0`;
      const stdout: Buffer[] = [];
      let stderr = "";
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
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.equal(Buffer.concat(stdout).toString("hex"), "e803640030f8c800b80bd4fe60f070fe");
      assert.deepEqual(volume.readFileSync("/pair.wav"), Buffer.from(input));
      assert.deepEqual(volume.readdirSync("/"), ["pair.wav"]);
    });
  }
}
