import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [expression, count, length, framing, trim, first] of [
    ["POS", 12, 12, "asetnsamples=3:0,", "end_pts=6", 0],
    ["PTS", 6, 12, "asetnsamples=3:0,", "end_pts=6", 0],
    ["if(isnan(POS)\\,0\\,PTS)", 6, 12, "asetnsamples=3:0,", "end_pts=6", 0],
    ["POS+N", 6, 12, "asetnsamples=3:0,", "end_pts=6", 0],
    ["POS", 512, 1600, "", "start_pts=1024:end_pts=2048", 512],
    ["POS", 512, 1600, "asetnsamples=256:0,", "start_pts=1024:end_pts=2048", 512],
    ["POS", 512, 1600, "asetnsamples=256:0,aselect=gte(n\\,2),", "end_pts=2048", 512],
    ["POS", 512, 1600, "asetnsamples=256:0,atrim=start_sample=512,", "end_pts=2048", 512]
  ] as const) {
    for (const empty of [false, true]) {
      it(`asetpts evaluates ${expression} using input position after ${framing} with ${graph ? "complex" : "simple"} filters and ${empty ? "empty" : "populated"} audio`, async () => {
        const input = Buffer.alloc(length * 2);
        for (let i = 0; i < length; i++) input.writeInt16LE(i + 1, i * 2);
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = `${empty ? "atrim=end_sample=0," : ""}${framing}asetpts=${expression},atrim=${trim}`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
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
        assert.deepEqual(volume.readFileSync("/out.raw"), input.subarray(first * 2, empty ? first * 2 : (first + count) * 2));
      });
    }
  }
}
