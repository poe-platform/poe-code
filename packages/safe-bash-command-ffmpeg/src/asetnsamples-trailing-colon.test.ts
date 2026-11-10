import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = Array.from({ length: 11 }, (_, index) => index + 1);
const input = Buffer.alloc(samples.length * 2);
for (const [index, sample] of samples.entries()) input.writeInt16LE(sample, index * 2);

for (const graph of [false, true]) {
  for (const [options, pad] of [
    ["4", true], ["4:", true], ["n=4:", true],
    ["n=4:p=1:", true], ["n=4:p=0:", false],
    ["4:0:", false], ["nb_out_samples=4:pad=false:", false],
    ["4::", false], ["n=4:p=:", false], ["n=:", undefined]
  ] as const) {
    it(`asetnsamples=${options} handles a trailing colon (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input });
      if (pad === undefined) volume.writeFileSync("/out.raw", "KEEP");
      let stderr = "";
      const filter = `asetnsamples=${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (pad === undefined) {
        assert.equal(result.exitCode, 234, stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const expected = pad ? Buffer.concat([input, Buffer.alloc(2)]) : input;
        assert.deepEqual(volume.readFileSync("/out.raw"), expected);
      }
    });
  }
}
