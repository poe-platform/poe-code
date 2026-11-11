import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 groups these 29 samples into 4,4,4,4,4,4,4,1 even without a replay.
for (const graph of [false, true]) {
  for (const filter of ["aloop=1:4:50", "aloop=1:4:29",
    "asetnsamples=8:0,aloop=1:4:-1:0.005"]) {
    for (const select of [false, true]) {
      it(`preserves aloop grouping past EOF: ${filter} (graph=${graph}, select=${select})`, async () => {
        const input = Buffer.alloc(58);
        for (let i = 0; i < 29; i++) input.writeInt16LE(i + 1, i * 2);
        const fs = Volume.fromJSON({ "/in.raw": input });
        const chain = `${filter}${select ? ",aselect='eq(n,1)'" : ""},ashowinfo`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
            "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
            async stat(path: string) { return fs.statSync(path); } },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(fs.readFileSync("/out.raw"), select ? input.subarray(8, 16) : input);
        assert.deepEqual(stderr.split("\n").filter(line => line.startsWith("[ashowinfo]")).map(line => {
          const fields = line.split(" ");
          return [Number(fields.find(field => field.startsWith("pts:"))!.slice(4)),
            Number(fields.find(field => field.startsWith("nb_samples:"))!.slice(11))];
        }), select ? [[4, 4]] : Array.from({ length: 8 }, (_, i) => [i * 4, i === 7 ? 1 : 4]));
        assert.deepEqual(fs.readFileSync("/in.raw"), input);
      });
    }
  }
}
