import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete PCM16 outputs from FFmpeg 7.0.2 with this 12-sample mono WAV.
for (const [program, downstream, expected] of [
  ["anull", "aselect=eq(n\\,1)", [401, 791, 1410, 2334]],
  ["asetnsamples=n=3:p=0", "aselect=eq(n\\,1)", [245]],
  ["anull", "anull", [61, 122, 184, 245, 401, 791, 1410, 2334, 3647, 5441, 7700, 9994]],
  ["asetnsamples=n=4:p=0", "aselect=eq(n\\,1)", [401, 791, 1410, 2334]],
  ["asetnsamples=n=3:p=0", "aselect=eq(n\\,2)", [401, 791]],
  ["asetnsamples=n=3:p=0", "aselect=eq(n\\,5)", [5441, 7700, 9994]]
] as const) {
  it(`sidechaingate retains control frame boundaries with ${program},${downstream}`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 12 }, (_, i) => (i + 1) * 1000 / 32768)] }));
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-filter_complex",
        `[0:a]asplit[x][y];[x]${program}[a];[y]asetnsamples=n=4:p=0[b];[a][b]sidechaingate,${downstream}[o]`,
        "-map", "[o]", "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(),
      stdout: { async write(b: Uint8Array) { stdout.push(b); } },
      stderr: { async write(b: Uint8Array) { stderr.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
    assert.equal(Buffer.concat(stderr).toString(), "");
    const pcm = Buffer.concat(stdout);
    assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)), expected);
  });
}
