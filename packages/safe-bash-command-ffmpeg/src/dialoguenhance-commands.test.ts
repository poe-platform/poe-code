import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/dialoguenhance-commands.wav", import.meta.url));

// Native FFmpeg 7.0.2, stereo PCM16 at 8 kHz. The command takes effect at
// sample 2048; center output still includes overlap from earlier FFT blocks.
for (const complex of [false, true]) {
  for (const [filter, expected] of [
    ["dialoguenhance@d=enhance=0", [7289, -8737, -6552]],
    ["dialoguenhance@d=enhance=0:original=0", [0, 0, 0]],
    ["asendcmd=c='0.256 dialoguenhance@d original 0',dialoguenhance@d=enhance=0", [7289, -4607, 0]],
    ["asendcmd=c='0.256 dialoguenhance original 0',dialoguenhance@d=enhance=0", [7289, -4607, 0]],
    ["asendcmd=c='0.2 dialoguenhance@d original 0',dialoguenhance@d=enhance=0", [7289, -4607, 0]],
    ["asendcmd=c='0 dialoguenhance@d original 0;0.256 dialoguenhance@d original 1',dialoguenhance@d=enhance=0", [0, -4130, -6552]],
    ["asendcmd=c='0.256 dialoguenhance@other original 0',dialoguenhance@d=enhance=0", [7289, -8737, -6552]],
    ["asendcmd=c='0 dialoguenhance@d original 0',dialoguenhance@d=enhance=0", [0, 0, 0]],
    ["asendcmd=c='0.256 dialoguenhance@d original 0;0.32 dialoguenhance@d original 2',dialoguenhance@d=enhance=0", [7289, -4607, 0]],
    ["asendcmd=c='0.256 dialoguenhance@d original 0/2',dialoguenhance@d=enhance=0", [7289, -4607, 0]]
  ] as const) {
    it(`preserves dialogue overlap for ${filter} (${complex ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", ...(complex
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-c:a", "pcm_s16le", "/out.wav"],
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
      assert.equal(audio.sampleRate, 8000);
      const source = parseWav(input).tracks[0]!.decodedAudio!;
      assert.equal(audio.channelData[0]!.length, source.channelData[0]!.length);
      for (let channel = 0; channel < 2; channel++) {
        for (let frame = 0; frame < audio.channelData[channel]!.length; frame++) {
          assert.equal(audio.channelData[channel]![frame], frame < 1536 ? 0 : source.channelData[channel]![frame - 1536], `channel ${channel}, frame ${frame}`);
        }
      }
      for (const [index, frame] of [2047, 2801, 3600].entries()) {
        assert.ok(Math.abs(audio.channelData[2]![frame]! * 32768 - expected[index]!) <= 1,
          `center frame ${frame}: ${audio.channelData[2]![frame]! * 32768} vs ${expected[index]}`);
      }
    });
  }
}
