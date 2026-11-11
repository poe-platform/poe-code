import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output for the 12-sample ramp below.
for (const [program, trim] of [
  ["asetpts=PTS+4", "end_pts=7"],
  ["anull", "end_pts=7"],
  ["asetpts=PTS+4", "end_sample=7"],
  ["asetpts=PTS-4", "end_pts=7"],
  ["asetnsamples=n=3:p=0,asetpts=PTS+4", "end_pts=7"]
]) {
  it(`sidechaingate starts output at zero after ${program} with atrim=${trim}`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 12 }, (_, i) => (i + 1) * 1000 / 32768)] }));
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-filter_complex",
        `[0:a]asplit[x][y];[x]${program}[a];[y]anull[b];[a][b]sidechaingate,atrim=${trim}[o]`,
        "-map", "[o]", "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write(b: Uint8Array) { output.push(b); } },
      stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(Buffer.concat(errors).toString(), "");
    const pcm = Buffer.concat(output);
    assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)),
      [61, 122, 184, 245, 401, 791, 1410]);
  });
}
