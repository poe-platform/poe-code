import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 accepts scheduling options without changing merged PCM.
for (const options of [
  "inputs=2", "inputs=2:threads=1", "inputs=2:thread_type=slice", "inputs=2:extra_hw_frames=1",
  "threads=1", "thread_type=slice", "extra_hw_frames=1",
  "2:threads=0:thread_type=none+slice:extra_hw_frames=-1",
  "threads=1+1:thread_type=all-slice:extra_hw_frames=0:inputs=2",
  "threads=default:extra_hw_frames=min", "threads=2147483647:extra_hw_frames=2147483647",
  "threads=1:threads=2:inputs=2", "inputs=2: threads = 1 : extra_hw_frames = 1"
]) {
  it(`amerge preserves PCM with generic options: ${options}`, async () => {
    const result = await run(options, "pipe:1");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.toString("hex"), "01000100fdfffdff1b001b00");
  });
}

for (const options of [
  "threads=-1", "threads=2147483648", "threads=bogus", "threads=-1:threads=1",
  "thread_type=0.5", "thread_type=4294967296", "thread_type=bogus",
  "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=bogus",
  "extra_hw_frames=-2:extra_hw_frames=1", "threads=1:unknown=1"
]) {
  it(`amerge rejects invalid generic options without replacing output: ${options}`, async () => {
    const result = await run(`inputs=2:${options}`, "/out.raw");
    assert.notEqual(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.volume.readFileSync("/out.raw", "utf8"), "KEEP");
  });
}

async function run(options: string, output: string) {
  const input = Buffer.from("0100fdff1b00", "hex");
  const volume = Volume.fromJSON({ "/i0.s16le": input, "/i1.s16le": input, "/out.raw": "KEEP" });
  const stdout: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/i0.s16le",
      "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/i1.s16le",
      "-filter_complex", `[0:a][1:a]amerge=${options}[o]`, "-map", "[o]", "-f", "s16le", output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.deepEqual(volume.readFileSync("/i0.s16le"), input);
  assert.deepEqual(volume.readFileSync("/i1.s16le"), input);
  return { ...result, stdout: Buffer.concat(stdout), stderr, volume };
}
