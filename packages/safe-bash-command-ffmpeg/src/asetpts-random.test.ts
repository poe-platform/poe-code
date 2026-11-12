import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(filter: string, complex: boolean) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from({ length: 17 }, (_, index) => (index + 1) / 32768)] }));
  let stdout = "", stderr = "";
  const chain = `asetnsamples=4:p=0,${filter}`;
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav",
      ...(complex ? ["-filter_complex", `[0:a]${chain}[a]`, "-map", "[a]"] : ["-af", chain]),
      "-f", "framecrc", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, rows: stdout.split("\n").filter(line => line && !line.startsWith("#"))
    .map(line => line.split(",").map(field => field.trim())) };
}

for (const complex of [false, true]) {
  // Native FFmpeg 7.0.2: 17 mono s16 samples, 8 kHz, grouped into 4-sample frames.
  for (const [filter, timestamps] of [
    ["asetpts=N*20+random(1)*40", [9, 118, 162, 241, 325]],
    [String.raw`asetpts=N*20+randomi(1\,0\,40)`, [9, 118, 162, 241, 325]],
    ["asetpts='N*20+if(0,random(1),random(1))*40'", [9, 118, 162, 241, 325]],
    ["asetpts='N*20+(st(1,0)+random(1))*40'", [9, 89, 169, 249, 329]],
    ["asetpts=N*20+random(1)*40,asetpts=PTS+random(1)*40", [18, 156, 164, 242, 330]]
  ] as const) {
    it(`keeps native random timestamps and audio checksums (${complex ? "graph" : "simple"}): ${filter}`, async () => {
      const control = await run("asetpts=N*20", complex);
      assert.equal(control.result.exitCode, 0, control.stderr);
      assert.deepEqual(control.rows, [
        ["0", "0", "0", "4", "8", "0x0028000a"],
        ["0", "80", "80", "4", "8", "0x0078001a"],
        ["0", "160", "160", "4", "8", "0x00c8002a"],
        ["0", "240", "240", "4", "8", "0x0118003a"],
        ["0", "320", "320", "1", "2", "0x00220011"]
      ]);
      for (let repeat = 0; repeat < 2; repeat++) {
        const actual = await run(filter, complex);
        assert.equal(actual.result.exitCode, 0, actual.stderr);
        assert.deepEqual(actual.rows, control.rows.map((row, index) =>
          [row[0], String(timestamps[index]), String(timestamps[index]), ...row.slice(3)]));
      }
    });
  }

  for (const expression of ["random()", "random(1,2)", "randomi(1,0)"]) {
    it(`rejects malformed asetpts random calls (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const actual = await run(`asetpts='${expression}'`, complex);
      assert.notEqual(actual.result.exitCode, 0);
      assert.deepEqual(actual.rows, []);
    });
  }
}
