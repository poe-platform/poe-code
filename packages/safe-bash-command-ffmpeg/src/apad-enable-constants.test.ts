import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: eight mono PCM16 samples at 8 kHz, then three silent samples.
for (const [expression, padding] of [
  ["gt(PI,0)", 3],
  ["gt(E,0)", 3],
  ["gt(PHI,0)", 3],
  ["gt(3,0)", 3],
  ["gt(pi,0)", null]
] as const) {
  for (const graph of [false, true]) {
    it(`apad enable=${expression} (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(16);
      for (let index = 0; index < 8; index++) input.writeInt16LE(101 + index, index * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const filter = `apad=pad_len=3:enable='${expression}'`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
      if (padding === null) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("apad enable: invalid or unsupported expression"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat([input, Buffer.alloc(padding * 2)]));
      }
    });
  }
}
