import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const levels of [[12000], [12000, -4000]]) {
  for (const graph of [false, true]) {
    for (const filter of [
      "aformat",
      ...["cl", "channel_layouts"].flatMap(key =>
        ["mono|stereo", "stereo|mono", "stereo", "mono", "mono|bad", "bad|stereo"].map(layout => `aformat=${key}=${layout}`))
    ]) {
      it(`negotiates ${filter} for ${levels.length} channels (graph=${graph})`, async () => {
        const volume = Volume.fromJSON({ "/output.wav": "keep" });
        volume.writeFileSync("/input.wav", encodeWav({
          sampleRate: 8000,
          channels: levels.map(level => new Float64Array(1024).fill(level / 32768))
        }));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-i", "/input.wav",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-c:a", "pcm_s16le", "/output.wav"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (filter.includes("bad")) {
          assert.equal(result.exitCode, 234);
          assert.match(stderr, /aformat: unsupported channel layout/);
          assert.equal(volume.readFileSync("/output.wav", "utf8"), "keep");
          return;
        }
        assert.equal(result.exitCode, 0, stderr);
        const audio = parseWav(volume.readFileSync("/output.wav") as Buffer).tracks[0]!.decodedAudio!;
        // Native FFmpeg preserves an allowed input layout regardless of list order.
        // A forced mono downmix averages L/R; mono to stereo uses equal-power gains.
        const expected = filter.endsWith("=mono") && levels.length === 2 ? [4000]
          : filter.endsWith("=stereo") && levels.length === 1 ? [8485, 8485] : levels;
        assert.equal(audio.sampleRate, 8000);
        assert.equal(audio.channels, expected.length);
        assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)),
          expected.map(level => new Array<number>(1024).fill(level)));
      });
    }
  }
}
