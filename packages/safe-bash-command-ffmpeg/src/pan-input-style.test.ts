import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const expression of ["mono|c0=FL+c1", "stereo|FL=FL|FR=c1"]) {
  for (const complex of [false, true]) {
    for (const existing of [false, true]) {
      it(`rejects mixed pan inputs without writing raw PCM (${expression}, graph=${complex}, existing=${existing})`, async () => {
        const volume = Volume.fromJSON(existing ? { "/out.raw": "keep" } : {});
        const left = [1, 3, 5, 7, -1, -3, 30001, -31001];
        const right = [80, 160, 240, 320, -400, -480, 555, -630];
        const pcm = Buffer.alloc(left.length * 4);
        for (const [frame, sample] of left.entries()) {
          pcm.writeInt16LE(sample, frame * 4);
          pcm.writeInt16LE(right[frame]!, frame * 4 + 2);
        }
        volume.writeFileSync("/lr.raw", pcm);
        let stderr = "";
        const filters = complex
          ? ["-filter_complex", `[0:a]pan=${expression}[s]`, "-map", "[s]"]
          : ["-af", `pan=${expression}`];
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/lr.raw",
            ...filters, "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 234);
        assert.ok(stderr.includes("cannot mix named and numbered input channels"), stderr);
        if (existing) assert.equal(volume.readFileSync("/out.raw", "utf8"), "keep");
        else assert.equal(volume.existsSync("/out.raw"), false);
      });
    }
  }
}
