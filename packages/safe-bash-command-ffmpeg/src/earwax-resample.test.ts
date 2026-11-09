import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 9.0.1: -cpuflags 0 -i <input.wav> -af earwax -f s16le <expected.pcm>.
// Disable CPU-specific rounding differences; compare every sample, including the drain.
for (const complex of [false, true]) {
  for (const [name, frames] of [["low", 11351], ["hi", 1892], ["st", 2059]] as const) {
    it(`earwax ${complex ? "graph" : "simple"}: native ${name} stereo samples and drain`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", readFileSync(new URL(`./fixtures/earwax/${name}.wav`, import.meta.url)));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", ...(complex
          ? ["-filter_complex", "[0:a]earwax[s]", "-map", "[s]"] : ["-af", "earwax"]), "-c:a", "pcm_s16le", "/out.wav"],
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
      assert.equal(audio.channels, 2);
      assert.equal(audio.sampleRate, 44100);
      const expected = readFileSync(new URL(`./fixtures/earwax/${name}.pcm`, import.meta.url));
      assert.equal(expected.length, frames * 4);
      for (const [channel, samples] of audio.channelData.entries()) {
        assert.equal(samples.length, frames);
        for (const [frame, sample] of samples.entries()) {
          assert.equal(sample * 32768, expected.readInt16LE((frame * 2 + channel) * 2), `channel ${channel}, frame ${frame}`);
        }
      }
    });
  }
}
