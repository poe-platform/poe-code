import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const previous of ["PREV_INPTS", "PREV_INT/TB"]) {
  const variable = previous.split("/")[0]!;
  const expression = `if(isnan(${variable})\\,0\\,${previous}+2)`;
  for (const complex of [false, true]) {
    for (const [prefix, suffix, count, frames] of [
      ["", ",atrim=end_pts=6", 7, [[0, 3], [2, 3], [5, 1]]],
      ["asetpts=PTS+8,", "", 12, [[0, 3], [10, 3], [13, 3], [16, 3]]],
      ["asetpts=PTS-8,", "", 12, [[0, 3], [-6, 3], [-3, 3], [0, 3]]],
      [`asetpts=${expression},`, "", 12, [[0, 3], [2, 3], [4, 3], [7, 3]]],
      ["atrim=end_sample=0,", "", 0, []]
    ] as const) {
      it(`${variable} uses previous input timestamps after ${prefix || "input"} (${complex ? "complex" : "simple"})`, async () => {
        const input = Buffer.alloc(24);
        for (let i = 0; i < 12; i++) input.writeInt16LE(i + 1, i * 2);
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = `asetnsamples=3:0,${prefix}asetpts=${expression}${suffix},ashowinfo`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
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
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
          Array.from({ length: count }, (_, i) => i + 1));
        const actualFrames = stderr.split("\n").filter(line => line.includes("nb_samples:")).map(line => {
          const fields = line.split(" ");
          return [Number(fields.find(field => field.startsWith("pts:"))!.slice(4)),
            Number(fields.find(field => field.startsWith("nb_samples:"))!.slice(11))];
        });
        assert.deepEqual(actualFrames, frames);
      });
    }
  }
}
