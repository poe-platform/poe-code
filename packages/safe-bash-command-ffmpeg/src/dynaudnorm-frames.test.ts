import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, graph: boolean, sampleRate = 8000, length = 8137) {
  const fs = Volume.fromJSON({});
  fs.writeFileSync("/in.wav", encodeWav({ sampleRate,
    channels: [Float64Array.from({ length }, (_, i) => (500 + i % 1000) / 32768)] }));
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-i", "/in.wav", ...(graph
      ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
    "-f", "s16le", "/out.pcm"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return fs.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
      async stat(path: string) { return fs.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return { pcm: fs.readFileSync("/out.pcm") as Buffer, stderr };
}

// Native FFmpeg reframes dynaudnorm=f=10 at 8 kHz into 80-sample frames,
// including a final 57-sample frame for this 8137-sample input.
for (const graph of [false, true]) {
  for (const [n, start, end] of [[1, 80, 160], [101, 8080, 8137]] as const) {
    it(`dynaudnorm selects output frame ${n} (${graph ? "graph" : "simple"})`, async () => {
      const baseline = await run("dynaudnorm=f=10:g=3", graph);
      const selected = await run(`dynaudnorm=f=10:g=3,aselect='eq(n,${n})'`, graph);
      assert.equal(selected.pcm.length, (end - start) * 2);
      assert.deepEqual(selected.pcm, baseline.pcm.subarray(start * 2, end * 2));
    });
  }

  it(`dynaudnorm passes frame numbers to conditional volume (${graph ? "graph" : "simple"})`, async () => {
    const baseline = await run("dynaudnorm=f=10:g=3", graph);
    const muted = await run("dynaudnorm=f=10:g=3,volume=0:enable='eq(n,1)'", graph);
    assert.equal(muted.pcm.length, baseline.pcm.length);
    for (let i = 0; i < baseline.pcm.length / 2; i++) {
      const sample = muted.pcm.readInt16LE(i * 2);
      if (i >= 80 && i < 160) assert.equal(sample, 0, `muted sample ${i}`);
      // Native volume defaults to float precision before PCM16 conversion.
      else assert.ok(Math.abs(sample - baseline.pcm.readInt16LE(i * 2)) <= 1, `sample ${i}`);
    }
  });

  for (const [prefix, pts] of [
    ["", (start: number) => start],
    ["asetpts=PTS+8000,", (start: number) => start + 8000],
    ["asetnsamples=n=300:p=0,asetpts=2*PTS,", (start: number) => start + Math.floor(start / 300) * 300],
    ["atrim=start_sample=17,", (start: number) => start + 17]
  ] as const) {
    it(`dynaudnorm preserves timestamps after ${prefix || "input"} (${graph ? "graph" : "simple"})`, async () => {
      const length = prefix.startsWith("atrim") ? 8137 - 17 : 8137;
      const result = await run(`${prefix}dynaudnorm=f=10:g=3,ashowinfo`, graph);
      const frames = result.stderr.split("\n").filter(line => line.includes("nb_samples:"));
      assert.equal(frames.length, Math.ceil(length / 80));
      for (const [n, line] of frames.entries()) {
        assert.ok(line.includes(`n:${n} pts:${pts(n * 80)} `), line);
        assert.ok(line.includes(`nb_samples:${Math.min(80, length - n * 80)} `), line);
      }
    });
  }
}

for (const [filter, rate, length, size] of [
  ["dynaudnorm", 8000, 8137, 4000],
  ["dynaudnorm=framelen=15:gausssize=3", 44100, 1500, 662],
  ["dynaudnorm=10:3", 8000, 57, 80]
] as const) {
  it(`${filter} exposes its rounded frame size at ${rate} Hz`, async () => {
    const result = await run(`${filter},ashowinfo`, false, rate, length);
    const frames = result.stderr.split("\n").filter(line => line.includes("nb_samples:"));
    assert.equal(frames.length, Math.ceil(length / size));
    for (const [n, line] of frames.entries()) {
      assert.ok(line.includes(`n:${n} pts:${n * size} `), line);
      assert.ok(line.includes(`nb_samples:${Math.min(size, length - n * size)} `), line);
    }
  });
}
