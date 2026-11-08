import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const option of ["-ac", "-ch_layout", "-channel_layout"]) {
    it(`downmixes stereo impulses with ${option} (${sync ? "sync fallback" : "async"})`, async () => {
      const left = new Float64Array(8192);
      const right = new Float64Array(8192);
      left[0] = 12000 / 32768;
      right[2048] = -8000 / 32768;
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 44100, channels: [left, right] }));
      const args = ["-v", "error", "-y", "-i", "/in.wav", option, option === "-ac" ? "1" : "mono", "-c:a", "pcm_s16le", "/out.wav"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
      }
      {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
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
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.channels, 1);
      assert.equal(audio.sampleRate, 44100);
      const expected = new Float64Array(8192);
      // Native FFmpeg PCM16 samples, excluding container headers.
      expected[0] = 6000;
      expected[2048] = -4000;
      assert.deepEqual(Float64Array.from(audio.channelData[0]!, sample => sample * 32768), expected);
    });
  }
}
