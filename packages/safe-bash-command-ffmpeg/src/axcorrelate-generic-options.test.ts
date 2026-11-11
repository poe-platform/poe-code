import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [valid, options] of [
  [true, ["", "threads=1", "thread_type=slice", "extra_hw_frames=1",
    "threads=1:thread_type=slice:extra_hw_frames=1",
    "threads=0:thread_type=0:extra_hw_frames=-1",
    "threads=1+1:extra_hw_frames=2-1"]],
  [false, ["threads=-1", "threads=2147483648", "threads=", "threads=bogus",
    "thread_type=bogus", "thread_type=0.5", "thread_type=4294967296",
    "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=",
    "threads=-1:threads=1", "threads=1:unknown=1", "enable=1"]]
] as const) {
  for (const option of options) {
    for (const output of ["pipe:1", "/out.pcm"]) {
      it(`axcorrelate generic options ${option || "control"} to ${output}`, async () => {
        const inputs = [137, 193].map(step => Buffer.from(encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length: 12 }, (_, i) => ((i * step) % 1700 - 850) / 32768)] })));
        const volume = Volume.fromJSON({ "/a.wav": inputs[0]!, "/b.wav": inputs[1]!, "/out.pcm": "KEEP" });
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
            `[0:a][1:a]axcorrelate=size=3${option ? `:${option}` : ""}[out]`,
            "-map", "[out]", "-f", "s16le", output],
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
        if (valid) {
          assert.equal(result.exitCode, 0, stderr);
          // Complete PCM output from native FFmpeg 7.0.2, including the EOF tail.
          const expected = Buffer.from("ff7fff7fff7fff7fff7fff7fff7f73997399ff7f2a900080", "hex");
          assert.deepEqual(output === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(output), expected);
        } else {
          assert.notEqual(result.exitCode, 0, option);
          assert.ok(stderr.includes("axcorrelate"), stderr);
          assert.equal(Buffer.concat(stdout).length, 0);
          assert.equal(volume.readFileSync("/out.pcm", "utf8"), "KEEP");
        }
        assert.deepEqual(volume.readFileSync("/a.wav"), inputs[0]);
        assert.deepEqual(volume.readFileSync("/b.wav"), inputs[1]);
      });
    }
  }
}
