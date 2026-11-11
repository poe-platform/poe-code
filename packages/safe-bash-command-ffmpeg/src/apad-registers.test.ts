import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Eight mono PCM16 samples at 1 kHz; the reported FFmpeg 7.0.2 cases add six zeros.
for (const [filter, padding, exitCode] of [
  [String.raw`apad=pad_len=st(0\,3)+ld(0)`, 6, 0],
  [String.raw`apad=whole_len=st(0\,7)+ld(0)`, 6, 0],
  [String.raw`apad=4096:st(0\,3)+ld(0)`, 6, 0],
  [String.raw`apad=4096:-1:st(0\,7)+ld(0)`, 6, 0],
  ["apad=pad_len=ld(0)", 0, 0],
  [String.raw`apad=pad_len=st(0\,3):pad_len=ld(0)`, 0, 0],
  [String.raw`apad=pad_len=st(0\,-1):whole_len=ld(0)+14`, 6, 0],
  [String.raw`apad=pad_len=st(0\,3),apad=pad_len=ld(0)`, 3, 0],
  [String.raw`apad=pad_len=st(0\,2.5)`, 2, 0],
  [String.raw`apad=whole_len=st(0\,13.5)`, 6, 0],
  [String.raw`apad=pad_len=st(0\,-2)`, 0, 222],
  ["apad=pad_len=st(0)", 0, 234],
  [String.raw`apad=whole_len=ld(0\,1)`, 0, 234],
  [String.raw`apad=pad_dur=st(0\,3)`, 0, 234]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} evaluates sample-length registers (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.from("e803d007b80ba00f88137017581b401f", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input, ...(exitCode ? { "/out.raw": "KEEP" } : {}) });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-t", "0.016", "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, exitCode, stderr);
      if (exitCode) assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      else assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat([input, Buffer.alloc(padding * 2)]));
    });
  }
}
