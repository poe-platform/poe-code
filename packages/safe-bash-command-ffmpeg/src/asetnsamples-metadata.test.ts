import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  for (const [before, after, expected] of [
    [4, 2, [5, 6, 7, 8]],
    [2, 4, []],
    [4, 4, [5, 6, 7, 8]]
  ] as const) {
    it(`preserves metadata from the first sample when reframing ${before} to ${after} (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(22);
      for (let i = 0; i < 11; i++) input.writeInt16LE(i + 1, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `asetnsamples=${before}:0,ametadata=mode=add:key=tag:value=yes:enable='eq(n,1)',asetnsamples=${after}:0,ametadata=mode=select:key=tag:value=yes`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
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
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
    });
  }
}
