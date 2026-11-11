import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2-static: four stereo f64le frames at 8 kHz, afade=ns=5.
// The final exponential gain differs from Math.exp by one bit, which also
// moves the near-threshold input below the PCM16 rounding boundary.
for (const [curve, format, sample, frames] of [
  ["exp", "f64le", "000000000000f03f", ["fa68e388b5f8e43e", "33431cebe2361a3f", "01aaf1d24d62503f", "7d14ae47e17a843f"]],
  ["tri", "f64le", "000000000000f03f", ["0000000000000000", "9a9999999999c93f", "9a9999999999d93f", "333333333333e33f"]],
  ["exp", "s16le", "fdffffffffbf723f", ["0000", "0000", "0000", "0100"]]
] as const) {
  for (const graph of [false, true]) it(`afade ${curve} matches native ${format} at three fifths (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({ "/in.raw": Buffer.from(sample.repeat(8), "hex") });
    const filter = `afade=ns=5:c=${curve}`;
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "f64le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-c:a", `pcm_${format}`, "-f", format, "/out.raw"],
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
    assert.equal(stderr, "");
    assert.deepEqual(fs.readFileSync("/out.raw"), Buffer.from(frames.map(frame => frame.repeat(2)).join(""), "hex"));
  });
}
