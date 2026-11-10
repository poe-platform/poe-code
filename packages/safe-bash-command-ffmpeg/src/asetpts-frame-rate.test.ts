import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const variable of ["FR", "FRAME_RATE"]) {
    for (const empty of [false, true]) {
      it(`asetpts treats ${variable} as unknown with ${graph ? "complex" : "simple"} filters and ${empty ? "empty" : "populated"} audio`, async () => {
        const input = Buffer.alloc(24);
        for (let i = 0; i < 12; i++) input.writeInt16LE(i + 1, i * 2);
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = `${empty ? "atrim=end_sample=0," : ""}asetnsamples=3:0,asetpts=if(isnan(${variable})\\,PTS\\,0),atrim=end_pts=6`;
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
        assert.deepEqual(volume.readFileSync("/out.raw"), input.subarray(0, empty ? 0 : 12));
      });
    }
  }
}
