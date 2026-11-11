import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const options of [
  "", "threads=1", "thread_type=slice", "extra_hw_frames=1",
  "threads=1:thread_type=slice:extra_hw_frames=1",
  "threads=default:thread_type=none:extra_hw_frames=min",
  "threads=max:thread_type=all:extra_hw_frames=max",
  "threads=1+1:thread_type=+slice-slice:extra_hw_frames=-1",
  "threads=1.5:thread_type=4294967295"
]) for (const graph of [false, true]) {
  it(`asoftclip ${options || "defaults"} preserves native PCM (${graph ? "graph" : "simple"})`, async () => {
    const { result, stderr, volume } = await run(options, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    // Native FFmpeg 7.0.2 output for this eight-sample mono PCM16 WAV.
    assert.equal((volume.readFileSync("/out.pcm") as Buffer).toString("hex"),
      "805f3ea700411dbd80251dd3a05a50f460a5af0b80dae22c00bfe24280a0c158");
  });
}

for (const options of [
  "threads=-1", "threads=2147483648", "threads=bogus", "threads=",
  "thread_type=bogus", "thread_type=0.5", "thread_type=4294967296",
  "extra_hw_frames=-2", "extra_hw_frames=2147483648",
  "threads=-1:threads=1", "unknown=1"
]) {
  it(`asoftclip rejects ${options} without replacing output`, async () => {
    const { result, stderr, volume } = await run(options);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("asoftclip"), stderr);
    assert.equal(volume.readFileSync("/out.pcm", "utf8"), "keep");
  });
}

async function run(options: string, graph = false) {
  const volume = Volume.fromJSON({ "/out.pcm": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from([-28000, -19000, -12000, -3000, 3000, 12000, 19000, 28000], sample => sample / 32768)
  ] }));
  const filter = `asoftclip${options ? `=${options}` : ""}`;
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-f", "s32le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, volume };
}
