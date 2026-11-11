import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: four stereo PCM16 frames [12000, -16000] at 1 kHz.
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
      it(`apulsator generic options ${option || "control"} (${graph ? "graph" : "simple"})`, async () => {
        const input = encodeWav({ sampleRate: 1000, channels: [
          new Float64Array(4).fill(12000 / 32768),
          new Float64Array(4).fill(-16000 / 32768)
        ] });
        const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.raw": "keep" });
        const filter = `apulsator=hz=100${option ? `:${option}` : ""}`;
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
        assert.equal(Buffer.concat(stdout).toString("hex"), valid ? "7017c0e037251ef3ba2d78feba2d78fe" : "");
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
        assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
      });
    }
  }
}
