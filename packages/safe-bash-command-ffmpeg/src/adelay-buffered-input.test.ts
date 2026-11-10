import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: needing another upstream frame leaves the initial silence untimed.
for (const complex of [false, true]) {
  for (const [upstream, untimed] of [
    ["anull", false],
    ["areverse", true],
    ["areverse,areverse", true],
    ["asetnsamples=n=3:p=0", false],
    ["asetnsamples=n=4:p=0", false],
    ["asetnsamples=n=5:p=0", true],
    ["asetnsamples=n=11:p=0", true],
    ["asetnsamples=n=20:p=0", true]
  ] as const) {
    it(`adelay preserves initial silence timing after ${upstream} (complex ${complex})`, async () => {
      const input = Buffer.alloc(44);
      for (let i = 0; i < 11; i++) {
        input.writeInt16LE((i + 1) * 100, i * 4);
        input.writeInt16LE(-(i + 1) * 100, i * 4 + 2);
      }
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `asetnsamples=n=4:p=0,${upstream},adelay=3S|5S,aselect=isnan(pts)`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.alloc(untimed ? 12 : 0));
    });
  }
}
