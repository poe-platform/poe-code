import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg evaluates once during setup, then once per 512-sample WAV frame.
for (const [expression, offset] of [
  ["if(gt(n,0),volume+0.25,0.25)", 1],
  ["if(isnan(volume),0.25,volume+0.25)", 2]
] as const) {
  it(`carries previous volume across frames for ${expression}`, async () => {
    const samples = Float64Array.from([[0, 600], [400, 1600], [12000, 1600], [0, 800], [4000, 1600], [0, 1000]]
      .flatMap(([amplitude, count]) => Array.from({ length: count! }, (_, i) => amplitude! * (i % 2 ? -1 : 1) / 32768)));
    const fs = Volume.fromJSON({ "/out.wav": "keep" });
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-i", "/in.wav", "-af", `volume=eval=frame:volume='${expression}'`, "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const actual = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.deepEqual(Array.from(actual, value => Math.round(value * 32768)),
      Array.from(samples, (value, index) => Math.max(-32768, Math.min(32767,
        Math.round(value * (Math.floor(index / 512) + offset) * 0.25 * 32768))) || 0));
  });
}
