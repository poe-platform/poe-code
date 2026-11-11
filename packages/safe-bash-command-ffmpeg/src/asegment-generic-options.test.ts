import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 16 }, (_, index) => index + 1);
const input = Buffer.alloc(samples.length * 2);
samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));

for (const split of ["samples=4", "timestamps=0.0005"]) {
  for (const options of ["", ":threads=1", ":thread_type=slice", ":extra_hw_frames=2",
    ":threads=1:thread_type=slice:extra_hw_frames=2",
    ":threads=default:thread_type=none:extra_hw_frames=min",
    ":threads=max:thread_type=all-slice:extra_hw_frames=max",
    ":threads=1+1:thread_type=+slice:extra_hw_frames=2-1"]) {
    for (const prefix of [true, false]) {
      it(`asegment ${split}${options} preserves the ${prefix ? "prefix" : "suffix"}`, async () => {
        const result = await run(`${split}${options}`, prefix, "pipe:1");
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        const expected = prefix ? samples.slice(0, 4) : samples.slice(4);
        assert.deepEqual(Array.from({ length: result.stdout.length / 2 }, (_, index) =>
          result.stdout.readInt16LE(index * 2)), expected);
      });
    }
  }
}

for (const option of ["threads=-1", "threads=2147483648", "threads=bogus", "threads=",
  "thread_type=bogus", "thread_type=0.5", "thread_type=4294967296",
  "extra_hw_frames=-2", "extra_hw_frames=2147483648", "extra_hw_frames=",
  "threads=-1:threads=1", "extra_hw_frames=-2:extra_hw_frames=2", "unknown=1"]) {
  it(`asegment rejects ${option} without replacing output`, async () => {
    const result = await run(`samples=4:${option}`, true, "/out.raw");
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.volume.readFileSync("/out.raw", "utf8"), "KEEP");
  });
}

async function run(options: string, prefix: boolean, output: string) {
  const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
  const chunks: Buffer[] = [];
  let stderr = "";
  const graph = `[0:a]asegment=${options}[b0][b1];` +
    (prefix ? "[b1]anullsink;[b0]anull[out]" : "[b0]anullsink;[b1]anull[out]");
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-hide_banner", "-loglevel", "error", "-f", "s16le", "-ar", "8000", "-ac", "1",
      "-i", "pipe:0", "-filter_complex", graph, "-map", "[out]", "-f", "s16le", output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () { yield input; })(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, stdout: Buffer.concat(chunks), volume };
}
