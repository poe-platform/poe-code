import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const shift of [0, 512]) {
  it(`evaluates volume at frame timestamps shifted by ${shift} samples`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/ramp.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 4800 }, (_, i) => (i + 1) / 32768)] }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/ramp.wav", "-af",
        `${shift ? `asetpts=PTS+${shift},` : ""}volume=volume=t:eval=frame`,
        "-c:a", "pcm_s16le", "/out.wav"],
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
    const samples = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    const pcm = Array.from(samples, sample => Math.round(sample * 32768));
    assert.equal(pcm.length, 4800);
    // Native FFmpeg 7.0.2: 512-sample frames, including the final partial frame.
    assert.equal(pcm[512], shift ? 66 : 33);
    assert.equal(pcm.at(-1), shift ? 3072 : 2765);
    assert.deepEqual(pcm, Array.from({ length: 4800 }, (_, i) =>
      Math.round(Math.fround((i + 1) / 32768 * Math.fround((Math.floor(i / 512) * 512 + shift) / 8000)) * 32768)));
  });
}
