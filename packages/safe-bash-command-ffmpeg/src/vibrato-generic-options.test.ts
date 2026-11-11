import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 8192 mono PCM16 samples (i % 30000 - 15000) at 8 kHz.
for (const [valid, options] of [
  [true, ["", "threads=1", "thread_type=slice", "extra_hw_frames=2",
    "threads=1:thread_type=slice:extra_hw_frames=2",
    "threads=0:thread_type=none:extra_hw_frames=-1",
    "threads=max:thread_type=all:extra_hw_frames=max",
    "threads=default+1:thread_type=+slice-slice:extra_hw_frames=min+1",
    "threads=1.5:extra_hw_frames=0.5", "thread_type=4294967295",
    "5:0.5:threads=1", "threads=1:f=5:d=0.5",
    "1:threads=1:5:d=0.5", "threads=1:enable=1"]],
  [false, ["threads=-1", "threads=2147483648", "threads=bogus", "threads=",
    "thread_type=bogus", "thread_type=0.5", "thread_type=4294967296",
    "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=",
    "threads=-1:threads=1", "threads=1:unknown=1"]]
] as const) {
  for (const option of options) {
    for (const graph of [false, true]) {
      it(`vibrato generic options ${option || "control"} (${graph ? "graph" : "simple"})`, async () => {
        const input = Buffer.alloc(8192 * 2);
        for (let i = 0; i < 8192; i++) input.writeInt16LE(i % 30000 - 15000, i * 2);
        const volume = Volume.fromJSON({ "/in.pcm": input, "/out.pcm": "keep" });
        const filter = `vibrato${option ? `=${option}` : ""}`;
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.pcm",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", valid ? "pipe:1" : "/out.pcm"],
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
        const output = Buffer.concat(stdout);
        if (valid) {
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
          assert.equal(output.length, input.length);
          assert.equal(createHash("sha256").update(output).digest("hex"),
            "6fa5b8c9f323e6877288b63e322521699ad1ef5bb44ef513edc79e6389d0ce22");
        } else {
          assert.notEqual(result.exitCode, 0);
          assert.ok(stderr.includes("vibrato"), stderr);
          assert.equal(output.length, 0);
        }
        assert.equal(volume.readFileSync("/out.pcm", "utf8"), "keep");
        assert.deepEqual(volume.readFileSync("/in.pcm"), input);
      });
    }
  }
}
