import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [expression, literal] of [
    ["amount='st(0,0.25);ld(0)*2'", "amount=0.5"],
    ["amount=ld(0)", "amount=0"],
    ["level_in='st(0,2)':amount=ld(0)", "level_in=2:amount=0"],
    ["amount='st(0,0.5)':amount=ld(0)", "amount=0"],
    ["mode='st(0,1);ld(0)'", "mode=triangle"],
    ["timing='st(0,1);ld(0)':ms=10", "timing=ms:ms=10"],
    ["amount='st(0,0.5)':mode=ld(0):timing=ld(0)", "amount=0.5:mode=sine:timing=bpm"]
  ] as const) {
    it(`apulsator ${expression} matches ${literal} (${graph ? "graph" : "simple"})`, async () => {
      const actual = await run(expression, graph);
      const expected = await run(literal, graph);
      assert.deepEqual(actual, expected);
      if (literal === "amount=0.5") {
        // Native FFmpeg 7.0.2 output for the first four stereo frames.
        assert.deepEqual(Array.from({ length: 8 }, (_, i) => actual.readInt16LE(i * 2)),
          [6000, -1500, 6003, -1499, 6006, -1498, 6009, -1498]);
      }
      if (literal === "amount=0") {
        assert.deepEqual(Array.from({ length: 16 }, (_, i) => actual.readInt16LE(i * 2)),
          Array.from({ length: 16 }, (_, i) => i % 2 === 0 ? 8000 : -2000));
      }
    });
  }
}

async function run(options: string, graph: boolean): Promise<Buffer> {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
    new Float64Array(8).fill(8000 / 32768),
    new Float64Array(8).fill(-2000 / 32768)
  ] }));
  let stderr = "";
  const filter = `apulsator=${options}`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
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
  const output = volume.readFileSync("/out.raw") as Buffer;
  assert.equal(output.length, 32);
  return output;
}
