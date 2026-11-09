import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, 8 kHz stereo: constant signed PCM16 samples 10000/-6000.
const frames = [455, 835, 1165, 1545];
for (const graph of [false, true]) {
  for (const [filter, hash] of [
    ["apulsator", "56a18a009b11afc9c4fe79533897e22a42081c045a3cb0da49af5d87f99dedd8"],
    ["apulsator=amount=0.5", "099ad90c6070762fbec44013dba50acc760e387d91501d369f51034dfdf026d5"]
  ] as const) {
    it(`${filter} preserves precision through PCM16 encoding (${graph ? "graph" : "simple"})`, async () => {
      const output = await run(filter, "s16le", graph);
      assert.equal(output.length, 8192);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
      if (filter === "apulsator=amount=0.5") {
        assert.deepEqual(frames.map(frame => output.readInt16LE(frame * 4)), [9139, 9917, 9917, 9139]);
      }
    });
  }

  it(`apulsator preserves double precision through PCM64 encoding (${graph ? "graph" : "simple"})`, async () => {
    const output = await run("apulsator=amount=0.5", "f64le", graph);
    assert.equal(output.length, 32768);
    const expected = [9138.500427279487, 9916.500255042269, 9916.500255042287, 9138.500427279661];
    for (const [index, frame] of frames.entries()) {
      assert.ok(Math.abs(output.readDoubleLE(frame * 16) * 32768 - expected[index]!) < 1e-10);
    }
  });
}

async function run(filter: string, format: string, graph: boolean): Promise<Buffer> {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    new Float64Array(2048).fill(10000 / 32768),
    new Float64Array(2048).fill(-6000 / 32768)
  ] }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", format, "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return volume.readFileSync("/out.raw") as Buffer;
}
