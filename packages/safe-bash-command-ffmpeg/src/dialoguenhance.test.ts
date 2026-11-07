import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { MediaBudgetTracker, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";
import { enhanceDialogue } from "./audio-dialogue.js";
import reference from "./dialoguenhance-pcm.json" with { type: "json" };

// Native FFmpeg 9.0.1 (macOS arm64) PCM reference: 8192 stereo frames, alternating +/-6000 every 50 frames.
for (const shared of [false, true]) {
  for (const complex of [false, true]) {
    it(`extracts dialogue center (${shared ? "shared" : "isolated"}, ${complex ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({});
      const channels = [0, 1].map(c => Float64Array.from({ length: 8192 }, (_, i) =>
        (shared ? (Math.floor(i / 50) % 2 ? 6000 : -6000) : c === 0 ? (i === 0 ? 12000 : 0) : (i === 2048 ? -8000 : 0)) / 32768));
      volume.writeFileSync("/twins.wav", encodeWav({ sampleRate: 44100, channels }));
      let stderr = "";
      const filters = complex ? ["-filter_complex", "[0:a]dialoguenhance[s]", "-map", "[s]"] : ["-af", "dialoguenhance"];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/twins.wav", ...filters, "-c:a", "pcm_s16le", "/out.wav"],
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
      assert.equal(audio.sampleRate, reference.sampleRate);
      assert.equal(audio.channelData[0]!.length, reference.frames);
      const center = Buffer.from(reference.center, "base64");
      for (let i = 0; i < 8192; i++) {
        for (let c = 0; c < 2; c++) assert.equal(audio.channelData[c]![i]! * 32768, i < 1536 ? 0 : channels[c]![i - 1536]! * 32768);
        const expected = shared ? center.readInt16LE(i * 2) : 0;
        // Float FFT implementations can differ by one s16 quantization unit.
        assert.ok(Math.abs(audio.channelData[2]![i]! * 32768 - expected) <= 1, `center frame ${i}: ${audio.channelData[2]![i]! * 32768} vs ${expected}`);
      }
      if (shared) {
        assert.equal(audio.channelData[2]![1536]! * 32768, -9499);
        assert.equal(audio.channelData[2]![2048]! * 32768, -10148);
      }
    });
  }
}

for (const expression of ["original=-1", "enhance=4", "voice=1", "voice=NaN", "unknown=1", "1:1:2:3"]) {
  it(`rejects dialogue option ${expression} without replacing output`, async () => {
    const volume = Volume.fromJSON({ "/out.wav": "existing" });
    volume.writeFileSync("/twins.wav", encodeWav({ sampleRate: 44100, channels: [new Float64Array(32), new Float64Array(32)] }));
    let stderr = "";
    const filters = ["-af", `dialoguenhance=${expression}`];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/twins.wav", ...filters, "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
    assert.equal(result.exitCode, 1);
    assert.ok(stderr.includes("dialoguenhance: invalid option"), stderr);
    assert.equal(volume.readFileSync("/out.wav", "utf8"), "existing");
  });
}

for (const sampleRate of [44100, 96000, 192000]) {
  it(`preserves short silence at ${sampleRate} Hz`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/twins.wav", encodeWav({ sampleRate, channels: [new Float64Array(513), new Float64Array(513)] }));
    let stderr = "";
    const filters = ["-af", "dialoguenhance=original=0:enhance=0:voice=32"];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/twins.wav", ...filters, "-c:a", "pcm_s16le", "/out.wav"],
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
    assert.equal(audio.sampleRate, sampleRate);
    for (const channel of audio.channelData) assert.deepEqual(Array.from(channel), new Array(513).fill(0));
  });
}

it("bounds dialogue working memory and honors cancellation", async () => {
  const channels = [new Float32Array(32), new Float32Array(32)];
  await assert.rejects(enhanceDialogue(channels, 44100, 1, 1, 2,
    new MediaBudgetTracker({ maxMemoryBytes: 65536 })), /maxMemoryBytes/);
  await assert.rejects(enhanceDialogue(channels, 44100, 1, 1, 2,
    new MediaBudgetTracker(), AbortSignal.abort()));
  await assert.rejects(enhanceDialogue(channels.slice(0, 1), 44100, 1, 1, 2,
    new MediaBudgetTracker()), /stereo input required/);
});
