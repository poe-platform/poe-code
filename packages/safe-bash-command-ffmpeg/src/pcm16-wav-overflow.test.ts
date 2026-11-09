import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { encodeWav, decodePcm, parseAudio } from "@poe-code/audio-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

for (const gate of [false, true]) {
  it(`converts large finite ${gate ? "sidechaingate" : "float64"} samples to WAV PCM16 like FFmpeg 7.0.2`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/in.wav", encodeWav({ sampleRate: 8000, channels: [gate
      ? new Float64Array(2048).fill(8000 / 32768)
      : Float64Array.from([0.25, 1.5, -1.5, 65535, 65536, 65944, 90949, 1])]
    }, gate ? {} : { float: true, bitsPerSample: 64 }));
    if (gate) await fs.writeFile("/key.wav", encodeWav({ sampleRate: 8000, channels: [
      Float64Array.from({ length: 2048 }, (_, i) => Math.floor(i / 512) % 2 * 20000 / 32768)
    ] }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", ...(gate ? ["-i", "/key.wav"] : []),
        "-filter_complex", gate ? "[0:a][1:a]sidechaingate=mode=upward:threshold=0.001[o]" : "[0:a]anull[o]",
        "-map", "[o]", "-c:a", "pcm_s16le", "/out.wav"],
      command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    assert.equal(result.exitCode, 0, stderr);
    const audio = decodePcm(parseAudio(await fs.readFile("/out.wav")));
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels.length, 1);
    const samples = Array.from(audio.channels[0]!, sample => sample * 32768);
    if (gate) {
      assert.equal(samples.length, 2048);
      assert.equal(samples[562], -32768);
      const pcm = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, i) => pcm.writeInt16LE(sample, i * 2));
      // All 2048 decoded samples from native FFmpeg 7.0.2-static x86_64.
      assert.equal(createHash("sha256").update(pcm).digest("hex"), "2ee3fc8326a5dca2bad706bbea6974e9bca464c4ce6ac6ae9ca05ad3d6564d8d");
    } else {
      assert.deepEqual(samples, [8192, 32767, -32768, 32767, -32768, -32768, -32768, 32767]);
    }
  });
}
