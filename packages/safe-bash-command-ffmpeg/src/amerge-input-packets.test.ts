import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(first: string, second: string, format: string, limit = false, reversed = false) {
  const volume = Volume.fromJSON({});
  for (let input = 0; input < 2; input++) {
    const bytes = Buffer.alloc(145 * 2);
    for (let sample = 0; sample < 145; sample++) bytes.writeInt16LE(input * 100 + sample + 1, sample * 2);
    volume.writeFileSync(`/${input}.raw`, bytes);
  }
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", ...[0, 1].flatMap(input => ["-f", "s16le", "-ar", "1000",
      "-channel_layout", "mono", "-i", `/${input}.raw`]), "-filter_complex",
    `[0:a]${first}[x];[1:a]${second}[y];${reversed ? "[y][x]" : "[x][y]"}amerge[out]`,
    "-map", "[out]", ...(limit ? ["-frames:a", "10"] : []), "-f", format, "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return Buffer.concat(chunks);
}

// Native FFmpeg 7.0.2: an earlier independent input queues across its 64-sample
// demux packets while the later input supplies seven-sample filter frames.
for (const [first, second, count] of [
  ["anull", "asetnsamples=7:0", 70],
  ["acopy", "asetnsamples=7:0", 70],
  ["anull", "asetnsamples=8:0", 80],
  ["asetnsamples=7:0", "anull", 64],
  ["volume=1", "asetnsamples=7:0", 64]
] as const) {
  for (const reversed of [false, true]) {
    it(`amerge limits ten packets with ${first}/${second} (reversed=${reversed})`, async () => {
      const output = await run(first, second, "s16le", true, reversed);
      const samples = Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2));
      assert.deepEqual(samples, Array.from({ length: count }, (_, i) =>
        reversed ? [i + 101, i + 1] : [i + 1, i + 101]).flat());
    });
  }
}

it("amerge preserves later-input packet durations and first-input timestamps across demux boundaries", async () => {
  const output = await run("anull", "asetnsamples=7:0", "framecrc");
  const packets = output.toString().split("\n").filter(line => line && !line.startsWith("#"))
    .map(line => line.split(",").slice(1, 5).map(Number));
  assert.deepEqual(packets, Array.from({ length: 21 }, (_, i) => {
    const duration = i < 20 ? 7 : 5;
    return [i * 7, i * 7, duration, duration * 4];
  }));
});

it("amerge preserves every PCM sample without a frame limit", async () => {
  const output = await run("anull", "asetnsamples=7:0", "s16le");
  assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
    Array.from({ length: 145 }, (_, i) => [i + 1, i + 101]).flat());
});
