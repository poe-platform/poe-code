import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete s16le output captured with native FFmpeg 7.0.2 for the first five cases.
for (const [filter, expected] of [
  ["anull", "0000002000e0004000c0006000a00000"],
  ["asoftclip=type=tanh", "0000591fa7e0273bd9c44d51b3ae0000"],
  ["asetnsamples=n=4:p=0,asoftclip=type=tanh:enable=n", "0000002000e00040d9c44d51b3ae0000"],
  ["asoftclip=type=tanh:enable=0", "0000002000e0004000c0006000a00000"],
  ["asoftclip=type=tanh:enable=1", "0000591fa7e0273bd9c44d51b3ae0000"],
  ["asetnsamples=n=4:p=0,asetpts=PTS+8,asoftclip=enable='gte(t,0.0015)'", "0000002000e00040d9c44d51b3ae0000"],
  ["asetnsamples=n=3:p=0,asoftclip=enable=n", "0000002000e0273bd9c44d51b3ae0000"]
] as const) for (const graph of [false, true]) {
  it(`${filter} preserves frame boundaries and PCM (${graph ? "graph" : "simple"})`, async () => {
    const { volume, result, stderr } = await run(filter, graph);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal((volume.readFileSync("/out.pcm") as Buffer).toString("hex"), expected);
  });
}

for (const enable of ["", "unknown", "gte(t,)"]) {
  it(`rejects invalid asoftclip enable=${enable} without replacing output`, async () => {
    const { volume, result, stderr } = await run(`asoftclip=enable='${enable}'`);
    assert.equal(result.exitCode, 1);
    assert.ok(stderr.includes("asoftclip enable"), stderr);
    assert.equal(volume.readFileSync("/out.pcm", "utf8"), "keep");
  });
}

async function run(filter: string, graph = false) {
  const volume = Volume.fromJSON({ "/out.pcm": "keep" });
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    Float64Array.from([0, 8192, -8192, 16384, -16384, 24576, -24576, 0], sample => sample / 32768)
  ] }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-c:a", "pcm_s16le", "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { volume, result, stderr };
}
