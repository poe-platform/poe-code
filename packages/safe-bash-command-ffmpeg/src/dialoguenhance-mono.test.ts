import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";
import monoReference from "./dialoguenhance-mono-pcm.json" with { type: "json" };

// Native FFmpeg 9.0.1: mono PCM16 input, -af dialoguenhance -f s16le.
for (const complex of [false, true]) {
  it(`negotiates mono dialogue input to stereo (${complex ? "graph" : "simple"})`, async () => {
    const volume = Volume.fromJSON({ "/mono.wav": Buffer.from(monoReference.input, "base64") });
    let stderr = "";
    const filters = complex ? ["-filter_complex", "[0:a]dialoguenhance[s]", "-map", "[s]"] : ["-af", "dialoguenhance"];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/mono.wav", ...filters, "-c:a", "pcm_s16le", "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.channels, 3);
    assert.equal(audio.channelMask, 7);
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channelData[0]!.length, 4096);
    assert.deepEqual(audio.channelData.map(channel => channel[2048]! * 32768), [5982, 5982, 10118]);
    const expected = Buffer.from(monoReference.pcm, "base64");
    for (let i = 0; i < 4096; i++) {
      for (let c = 0; c < 3; c++) {
        const actual = audio.channelData[c]![i]! * 32768;
        const sample = expected.readInt16LE((i * 3 + c) * 2);
        // Allow one PCM16 unit for floating-point mixing/FFT quantization.
        assert.ok(Math.abs(actual - sample) <= 1, `channel ${c}, frame ${i}: ${actual} vs ${sample}`);
      }
    }
  });
}

