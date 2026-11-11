import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg rescales incoming frame PTS to samples with nearest rounding,
// including ties away from zero, before applying afade's per-sample gain.
for (const [prefix, positions, reportedPts] of [
  ["asettb=1/3000,asetpts=PTS+1", [3, 4, 5, 6, 7, 8, 9, 10], [8]],
  ["asettb=1/3000,asetpts=PTS+2", [5, 6, 7, 8, 9, 10, 11, 12], [16]],
  ["asettb=1/8000,asetpts=PTS+3", [3, 4, 5, 6, 7, 8, 9, 10], [9]],
  ["asettb=1/16000,asetpts=PTS+1", [1, 2, 3, 4, 5, 6, 7, 8], [2]],
  ["asettb=1/16000,asetpts=PTS-1", [-1, 0, 1, 2, 3, 4, 5, 6], [-2]],
  ["asettb=1/3000,asetpts=PTS-1", [-3, -2, -1, 0, 1, 2, 3, 4], [-8]],
  ["asettb=1/3000,asetpts=PTS-2", [-5, -4, -3, -2, -1, 0, 1, 2], [-16]],
  ["asetnsamples=n=8:p=0,asettb=1/3000,areverse", [0, 1, 2, 3, 4, 13, 14, 15], [0, 40, 104, 168]]
] as const) {
  for (const type of ["in", "out"]) {
    for (const graph of [false, true]) it(`afade ${type} rounds frame samples after ${prefix} (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array(29).fill(16000 / 32768)] }));
      // A finer reporting time base exposes accidental mutation of fractional PTS.
      const filter = `${prefix},afade=t=${type}:ns=16,asettb=1/24000,ashowinfo`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
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
      const output = fs.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, 29 * 2);
      assert.deepEqual(Array.from(positions, (_, i) => output.readInt16LE(i * 2)),
        positions.map(position => Math.max(0, Math.min(16, type === "in" ? position : 16 - position)) * 1000));
      const reports = stderr.split("\n").filter(line => line.startsWith("[ashowinfo]"));
      assert.equal(reports.length, reportedPts.length, stderr);
      reportedPts.forEach((pts, n) => assert.ok(reports[n]!.includes(` n:${n} pts:${pts} `), stderr));
    });
  }
}
