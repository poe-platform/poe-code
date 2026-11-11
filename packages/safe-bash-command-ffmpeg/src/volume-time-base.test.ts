import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: fixed PCM16 retains asettb; conversion to float resets it.
for (const graph of [false, true]) for (const [suffix, expected] of [
  ["volume=tb*8000:precision=fixed:eval=frame", [200, 200, 200, 200, 200, 200, 200, 200]],
  ["volume=1+pts:precision=fixed:eval=frame", [100, 100, 200, 200, 300, 300, 400, 400]],
  ["volume=1+t*8000:precision=fixed:eval=frame", [100, 100, 300, 300, 500, 500, 700, 700]],
  ["volume=tb*8000:precision=fixed:eval=once", [200, 200, 200, 200, 200, 200, 200, 200]],
  ["volume=tb*8000:precision=0:eval=frame", [200, 200, 200, 200, 200, 200, 200, 200]],
  ["volume=tb*8000:eval=frame", [100, 100, 100, 100, 100, 100, 100, 100]],
  ["volume=1+pts:eval=frame", [100, 100, 300, 300, 500, 500, 700, 700]],
  ["volume=1+t*8000:eval=frame", [100, 100, 300, 300, 500, 500, 700, 700]],
  ["asetpts=PTS+2,volume=startpts:precision=fixed:eval=frame", [200, 200, 200, 200, 200, 200, 200, 200]],
  ["asetpts=PTS+2,volume=startt*8000:precision=fixed:eval=frame", [400, 400, 400, 400, 400, 400, 400, 400]],
  ["aformat=sample_fmts=flt,volume=tb*8000:precision=fixed:eval=frame", [100, 100, 100, 100, 100, 100, 100, 100]]
] as const) {
  it(`uses the negotiated volume clock for ${suffix} (graph=${graph})`, async () => {
    const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8).fill(100 / 32768)] });
    const fs = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
    const filter = `asetnsamples=n=2:p=0,asettb=1/4000,${suffix}`;
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav",
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
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
    assert.deepEqual(fs.readFileSync("/in.wav"), Buffer.from(input));
  });
}
