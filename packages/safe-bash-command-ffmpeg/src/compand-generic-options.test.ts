import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: the generic settings leave default compand PCM unchanged.
const input = encodeWav({ sampleRate: 8000, channels: [
  Float64Array.from([15, -127, 500, -3000, 28000, -19003, 3001, 100], value => value / 32768)
] });
const expected = Buffer.from("24720e00cead85fffda0e10180f3b5f420335e69bb617cb89e754b0b265c6000", "hex");

for (const graph of [false, true]) {
  for (const [options, exitCode] of [
    ["", 0], ["threads=1", 0], ["thread_type=slice", 0], ["extra_hw_frames=1", 0],
    ["threads=1:thread_type=slice:extra_hw_frames=1", 0],
    ["threads=0:thread_type=none:extra_hw_frames=-1", 0],
    ["threads=default:extra_hw_frames=min", 0],
    ["threads=1+1:thread_type=all-slice:extra_hw_frames=2-1", 0],
    ["threads=2147483647:thread_type=4294967295:extra_hw_frames=2147483647", 0],
    ["attacks=0:threads=1:decays=0.8:extra_hw_frames=1", 0],
    ["0:0.8:-70/-70|-60/-20|1/0:0.01:0:0:0:threads=1", 0],
    ["threads=1:threads=2", 0],
    ["threads=-1", 222], ["threads=2147483648", 222],
    ["threads=bogus", 234], ["threads=", 234],
    ["thread_type=bogus", 234], ["thread_type=0.5", 222],
    ["thread_type=4294967296", 222], ["thread_type=slice+", 234],
    ["extra_hw_frames=-2", 222], ["extra_hw_frames=2147483648", 222],
    ["extra_hw_frames=", 234], ["extra_hw_frames=bogus", 234],
    ["threads=-1:threads=1", 222], ["extra_hw_frames=-2:extra_hw_frames=1", 222],
    ["unknown=1", 8], ["threads=1:unknown=1", 8]
  ] as const) {
    it(`compand ${options || "defaults"} matches native status and PCM (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.pcm": "keep" });
      const filter = `compand${options ? `=${options}` : ""}`;
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s32le", exitCode === 0 ? "pipe:1" : "/out.pcm"],
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
      assert.deepEqual(Buffer.concat(stdout), exitCode === 0 ? expected : Buffer.alloc(0));
      if (exitCode === 0) assert.equal(stderr, "");
      else assert.ok(stderr.includes("compand"), stderr);
      assert.equal(volume.readFileSync("/out.pcm", "utf8"), "keep");
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
    });
  }
}
