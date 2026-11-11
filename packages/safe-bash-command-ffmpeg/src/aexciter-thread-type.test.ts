import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [option, exitCode] of [
    ...["", "threads=1", "thread_type=slice", "thread_type=0", "thread_type=1",
      "thread_type=none", "thread_type=default", "thread_type=all-slice",
      "thread_type=+slice", "thread_type=4294967295",
      "threads=1:thread_type=slice:extra_hw_frames=1"]
      .map(option => [option, 0] as const),
    ["thread_type=bogus", 234], ["thread_type=", 234], ["thread_type=slice+", 234],
    ["thread_type=0.5", 222], ["thread_type=4294967296", 222],
    ["thread_type=bogus:thread_type=slice", 234]
  ] as const) {
    it(`aexciter ${option || "defaults"} preserves native PCM/status (${graph ? "graph" : "simple"})`, async () => {
      const input = encodeWav({ sampleRate: 48000, channels: [new Float64Array(128).fill(16000 / 32768)] });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      const filter = `aexciter${option ? `=${option}` : ""}`;
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
      assert.equal(result.exitCode, exitCode, stderr);
      const output = Buffer.concat(stdout);
      if (exitCode === 0) {
        assert.equal(stderr, "");
        assert.equal(output.length, 256);
        // Native FFmpeg 7.0.2 output for the same 128-sample PCM16 input.
        assert.equal(createHash("sha256").update(output).digest("hex"),
          "d051ccfda1e05ec18d3f45726052e49ee98f2d7d77ee0c2e1df506658e7f93da");
      } else {
        assert.ok(stderr.includes("aexciter:"), stderr);
        assert.equal(output.length, 0);
      }
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
    });
  }
}
