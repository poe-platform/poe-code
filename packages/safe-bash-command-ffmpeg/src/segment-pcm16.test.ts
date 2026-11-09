import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const codec of [undefined, "pcm_s16le", "pcm_f32le"]) {
  it(`preserves ordinary WAV upmix samples in segments (${codec ?? "default codec"})`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/audio.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 24000 }, (_, i) => i / 32768)] }));
    for (const output of [["/plain.wav"],
      ["-f", "segment", "-segment_time", "1", "-segment_list", "/list.csv", "/part%02d.wav"]]) {
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/audio.wav", "-ac", "2",
          ...(codec === undefined ? [] : ["-c:a", codec]), ...output],
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
    }
    const filenames = String(volume.readFileSync("/list.csv", "utf8")).trim().split("\n")
      .map(row => row.split(",")[0]!);
    const plain = parseWav(volume.readFileSync("/plain.wav") as Buffer).tracks[0]!.decodedAudio!;
    const parts = filenames.map(filename =>
      parseWav(volume.readFileSync(`/${filename}`) as Buffer).tracks[0]!.decodedAudio!);
    assert.equal(plain.channelData.length, 2);
    assert.ok(parts.every(part => part.channelData.length === 2));
    for (let channel = 0; channel < 2; channel++) {
      const samples = parts.flatMap(part => Array.from(part.channelData[channel]!));
      assert.equal(samples.length, 24000);
      // Native FFmpeg 7.0.2 PCM16 values at the reported rounding boundaries.
      if (codec !== "pcm_f32le") {
        assert.equal(samples[169]! * 32768, 119);
        assert.equal(samples[507]! * 32768, 358);
      }
      assert.deepEqual(samples, Array.from(plain.channelData[channel]!));
    }
  });
}
