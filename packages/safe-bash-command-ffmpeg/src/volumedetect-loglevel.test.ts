import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const option of ["-v", "-loglevel"]) {
  for (const [level, reports] of [
    ["quiet", false], ["panic", false], ["fatal", false], ["error", false],
    ["warning", false], ["24", false], ["info", true], ["32", true],
    ["verbose", true], ["debug", true], ["trace", true], ["", true]
  ] as const) {
    for (const filter of ["volumedetect", "anull"]) {
      it(`${filter} respects ${option} ${level || "(default)"} without changing PCM`, async () => {
        const channels = [Float64Array.from([0.25, -0.25, 0.25, -0.25])];
        const fs = Volume.fromJSON({});
        fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels }));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-nostats", "-y", ...(level ? [option, level] : []),
            "-i", "/in.wav", "-af", filter, "-c:a", "pcm_s16le", "/out.wav"],
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
        assert.equal(stderr, (reports || level === "warning" || level === "24" ? "ffmpeg: Guessed Channel Layout: mono\n" : "") + (reports && filter === "volumedetect"
          ? "n_samples: 0\nn_samples: 4\nmean_volume: -12.0 dB\nmax_volume: -12.0 dB\n"
          : ""));
        const output = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        assert.equal(output.sampleRate, 8000);
        assert.deepEqual(output.channelData.map(channel => Array.from(channel)), channels.map(channel => Array.from(channel)));
      });
    }
  }
}
