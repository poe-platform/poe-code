import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: reported 16-frame stereo PCM16 fixture at 1 kHz.
for (const [valid, options] of [
  [true, ["", "threads=1", "thread_type=slice", "extra_hw_frames=1",
    "thread_type=none", "threads=default",
    "threads=1:thread_type=slice:extra_hw_frames=1",
    "threads=0:thread_type=0:extra_hw_frames=-1",
    "threads=max:thread_type=4294967295:extra_hw_frames=max",
    "threads=default+1:thread_type=+slice-slice:extra_hw_frames=min+1",
    "threads=1.5:extra_hw_frames=0.5", "threads=1:"]],
  [false, ["threads=-1", "threads=2147483648", "threads=bogus", "threads=",
    "thread_type=bogus", "thread_type=0.5", "thread_type=4294967296", "thread_type=slice+",
    "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=",
    "threads=-1:threads=1", "threads=1:unknown=1"]]
] as const) {
  for (const option of options) {
    for (const graph of [false, true]) {
      it(`aphaser generic options ${option || "control"} (${graph ? "graph" : "simple"})`, async () => {
        const input = encodeWav({ sampleRate: 1000, channels: [
          Float64Array.from({ length: 16 }, (_, i) => ((i * 97) % 30001 - 15000) / 32768),
          Float64Array.from({ length: 16 }, (_, i) => ((i * 257) % 20001 - 10000) / 32768)
        ] });
        const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.raw": "keep" });
        const filter = `aphaser${option ? `=${option}` : ""}`;
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", valid ? "pipe:1" : "/out.raw"],
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
        if (valid) assert.equal(result.exitCode, 0, stderr);
        else assert.notEqual(result.exitCode, 0, stderr);
        const output = Buffer.concat(stdout);
        assert.equal(output.length, valid ? 64 : 0);
        if (valid) {
          assert.equal(stderr, "");
          assert.equal(createHash("sha256").update(output).digest("hex"),
            "59be91bf176782bcee069839ff70f634f24d7ff6818e7e45c7159c1828ad13cf");
        }
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
        assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
      });
    }
  }
}
