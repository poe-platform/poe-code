import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Exact outputs from FFmpeg 7.0.2-static on Linux. The quatr sample lands
// on a PCM16 rounding tie; one bit of extra gain changes 102 to 103.
for (const [curve, format, sample] of [
  ["quatr", "f64le", 0.0031280517578125],
  ["quatr", "s16le", 102],
  ["tri", "f64le", 0.0020558687915352837],
  ["tri", "s16le", 67]
] as const) {
  for (const graph of [false, true]) it(`afade ${curve} matches native ${format} at four sevenths (${graph ? "graph" : "simple"})`, async () => {
    const input = Buffer.alloc(10 * 8);
    input.writeDoubleLE(0.0035977703851867468, 4 * 8);
    const fs = Volume.fromJSON({ "/in.raw": input });
    const filter = `afade=t=out:ss=1:ns=7:c=${curve}`;
    const output: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "f64le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", format, "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    const expected = Buffer.alloc(10 * (format === "f64le" ? 8 : 2));
    if (format === "f64le") expected.writeDoubleLE(sample, 4 * 8);
    else expected.writeInt16LE(sample, 4 * 2);
    assert.deepEqual(Buffer.concat(output), expected);
  });
}
