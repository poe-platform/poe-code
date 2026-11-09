import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 preserves the program during the silent key, then emits NaN
// for upward threshold=0. PCM16 conversion turns those NaNs into zero.
for (const options of ["mode=upward:threshold=0", "mode=upward:threshold=0:knee=1",
  "mode=upward:threshold=0:detection=peak", "threshold=0"]) {
  for (const codec of ["pcm_s16le", "pcm_f64le"]) {
    it(`sidechaingate ${options} preserves exact zero threshold behavior in ${codec}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/main.wav", encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(2048).fill(8000 / 32768)] }));
      volume.writeFileSync("/key.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 2048 }, (_, i) =>
          [0, 20000, 0, 20000][Math.floor(i / 512)]! / 32768)] }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-i", "/main.wav", "-i", "/key.wav", "-filter_complex",
          `[0:a][1:a]sidechaingate=${options}[o]`, "-map", "[o]", "-c:a", codec, "/out.wav"],
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
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channelData.length, 1);
      assert.equal(audio.channelData[0]!.length, 2048);
      for (const [i, value] of audio.channelData[0]!.entries()) {
        const expected = i < 512 || options === "threshold=0" ? 8000 / 32768
          : codec === "pcm_f64le" ? NaN : 0;
        assert.equal(value, expected, `sample ${i}`);
      }
    });
  }
}
