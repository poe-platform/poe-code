import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  for (const option of ["start_sample", "end_sample", "start_pts", "end_pts"]) {
    for (const [expression, count] of [
      [String.raw`min(2\,3)`, -1],
      ["'min(2,3)'", -1],
      [String.raw`'min(2\,3)'`, -1],
      [String.raw`min(2\\\,3)`, -1],
      [String.raw`max(2\,3)`, -1],
      ["'max(2,3)'", -1],
      ["'pow(min(2,3),2)'", -1],
      ["'if(0,max(2,3),2)'", -1],
      ["2", 2],
      ["3", 3],
      ["PI", 3],
      ["E", 3],
      ["PHI", 2],
      ["PI*2", 6],
      ["E+1", 4],
      ["PHI*2", 3],
      ["pi", -1],
      ["PI+unknown", -1],
      [String.raw`pow(2\,3)`, 8],
      [String.raw`clip(2\,1\,3)`, 2],
      ["2+3", 5],
      ["'st(0,3)+ld(0)'", 6],
      ["3+ld(0)", 3],
      ["3+3", 6],
      ["'st(0,3)+ld(0)+unknown'", -1],
      ["'st(0)'", -1],
      ["'ld(0,3)'", -1]
    ] as const) {
      for (const existing of [false, true]) {
        it(`atrim ${option}=${expression} (${complex ? "graph" : "simple"}, existing=${existing})`, async () => {
          const input = Buffer.alloc(48);
          for (let i = 0; i < 24; i++) input.writeInt16LE(i + 1, i * 2);
          const volume = Volume.fromJSON({ "/in.raw": input });
          const original = Buffer.from([255, 127]);
          if (existing) volume.writeFileSync("/out.raw", original);
          let stderr = "";
          const filter = `atrim=${option}=${expression}`;
          const result = await createFfmpegCommand().execute({
            args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
              ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
              "-f", "s16le", "/out.raw"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          if (count < 0) {
            assert.equal(result.exitCode, 234, stderr);
            if (existing) assert.deepEqual(volume.readFileSync("/out.raw"), original);
            else assert.equal(volume.existsSync("/out.raw"), false);
          } else {
            assert.equal(result.exitCode, 0, stderr);
            assert.deepEqual(volume.readFileSync("/out.raw"), option.startsWith("start_")
              ? input.subarray(count * 2) : input.subarray(0, count * 2));
          }
        });
      }
    }
  }
}
