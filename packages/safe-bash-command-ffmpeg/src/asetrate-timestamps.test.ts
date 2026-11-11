import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 29 }, (_, i) => i + 1);
const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples, sample => sample / 32768)] });

for (const graph of [false, true]) {
  // FFmpeg 7.0.2: one unchanged packet, rounded in the negotiated link time base.
  for (const [filter, rate, pts] of [
    ["asettb=1/1000,asetpts=PTS+1,asetrate=16000", 16000, 16],
    ["asettb=1/1000,asetpts=PTS+2,asetrate=16000", 16000, 16],
    ["asettb=1/1000,asetpts=PTS+1,asetrate=8000", 8000, 8],
    ["asetpts=PTS+8,asetrate=16000", 16000, 8],
    ["asettb=1/8000,asetpts=PTS+8,asetrate=16000", 16000, 8]
  ] as const) {
    it(`asetrate preserves packet data and rounds PTS: ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const output = await run(filter, graph, "framecrc");
      assert.ok(output.toString().includes(`#tb 0: 1/${rate}\n`), output.toString());
      const packets = output.toString().split("\n").filter(line => line && !line.startsWith("#"))
        .map(line => line.split(",").map(field => field.trim()));
      assert.deepEqual(packets, [["0", String(pts), String(pts), "29", "58", "0x231e01b3"]]);
    });
  }

  it(`asetrate rounds each frame without regrouping PCM (${graph ? "graph" : "simple"})`, async () => {
    const filter = "asetnsamples=n=8:p=0,asettb=1/1000,asetpts=PTS+1,asetrate=16000";
    const output = await run(filter, graph, "framecrc");
    const packets = output.toString().split("\n").filter(line => line && !line.startsWith("#"))
      .map(line => line.split(",").slice(1, 5).map(Number));
    assert.deepEqual(packets, [[16, 16, 8, 16], [16, 16, 8, 16], [32, 32, 8, 16], [32, 32, 5, 10]]);
    const pcm = await run(filter, graph, "s16le");
    assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)), samples);
  });

  for (const [threshold, expected] of [[0.00049, samples], [0.001, samples], [0.00125, []]] as const) {
    it(`aselect sees rounded asetrate time at ${threshold} (${graph ? "graph" : "simple"})`, async () => {
      const output = await run(`asettb=1/1000,asetpts=PTS+1,asetrate=16000,aselect='gte(t,${threshold})'`, graph, "s16le");
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
    });
  }

  for (const [prefix, selection] of [
    ["asettb=1/1000,asetpts=PTS-1,asetrate=16000", "eq(pts,-1)*eq(t,-0.001)*eq(TB,1/1000)"],
    ["asettb=1/8000,asetpts=PTS+8,asetrate=16000", "eq(pts,8)*eq(t,0.0005)*eq(TB,1/16000)"],
    ["asettb=1/1000,asetpts=PTS+1,asetrate=16000,asetrate=8000", "eq(pts,2)*eq(t,0.002)"]
  ]) {
    it(`asetrate negotiates the downstream clock: ${prefix} (${graph ? "graph" : "simple"})`, async () => {
      const output = await run(`${prefix},aselect='${selection}'`, graph, "s16le");
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), samples);
    });
  }
}

async function run(filter: string, graph: boolean, format: string): Promise<Buffer> {
  const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", format, "/out.dat"],
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
  return volume.readFileSync("/out.dat") as Buffer;
}
