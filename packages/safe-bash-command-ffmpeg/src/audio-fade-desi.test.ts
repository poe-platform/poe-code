import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Signed PCM16 captured from Linux FFmpeg 7.0.2-static at tenths of the fade.
for (const [curve, expected] of [
  ["desi", [0, -48, 384, -1296, 3072, -6000, 8928, -10703, 11616, -11952, 12000, -12000, 12000, -12000, 12000, -12000]],
  ["tri", [0, -1200, 2400, -3600, 4800, -6000, 7200, -8400, 9600, -10800, 12000, -12000, 12000, -12000, 12000, -12000]]
] as const) {
  for (const graph of [false, true]) it(`afade ${curve} matches native PCM16 at tenths (${graph ? "graph" : "simple"})`, async () => {
    const input = Buffer.alloc(32);
    for (let i = 0; i < 16; i++) input.writeInt16LE(i % 2 === 0 ? 12000 : -12000, i * 2);
    const fs = Volume.fromJSON({ "/in.raw": input });
    const filter = `afade=ns=10:c=${curve}`;
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ac", "1", "-ar", "8000", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = fs.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, input.length);
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
  });
}
