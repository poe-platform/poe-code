import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 reports ERANGE as 222 and EINVAL as 234.
for (const graph of [false, true]) {
  for (const [options, exitCode] of [
    ["m=1:dry=2", 222], ["mm=-1", 222], ["cm=101", 222],
    ["m=100.1", 222], ["wet=-0.1", 222], ["temp=-50.1", 222],
    ["temp=51", 222], ["0:0:1:2", 222],
    ["m=1:dry=oops", 234], ["m=1:dry=1+", 234], ["0:0:1:oops", 234]
  ] as const) {
    it(`compensationdelay=${options} exits ${exitCode} without output (${graph ? "graph" : "simple"})`, async () => {
      for (const output of ["pipe:1", "/out.raw"]) {
        const { result, stdout, stderr, volume } = await run(options, graph, output);
        assert.equal(result.exitCode, exitCode, stderr);
        assert.equal(stdout.length, 0);
        assert.ok(stderr.includes("compensationdelay: invalid"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
      }
    });
  }

  it(`compensationdelay=m=1:dry=1 preserves valid PCM (${graph ? "graph" : "simple"})`, async () => {
    const { result, stdout, stderr } = await run("m=1:dry=1", graph, "pipe:1");
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stdout.length, 256);
    assert.deepEqual([0, 32, 64, 96].map(i => stdout.readInt16LE(i * 2)), [256, 553, 617, 681]);
  });
}

async function run(options: string, graph: boolean, output: string) {
  const volume = Volume.fromJSON({ "/out.raw": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({
    sampleRate: 8000,
    channels: [Float64Array.from({ length: 128 }, (_, i) => (256 + i) / 32768)]
  }, { bitsPerSample: 16 }));
  const filter = `compensationdelay=${options}`;
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stdout: Buffer.concat(chunks), stderr, volume };
}
