import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

// Extensible PCM16 WAV: eight frames at 8 kHz, mask 0x5003 (FL, FR, TFL, TFR).
const input = readFileSync(new URL("./fixtures/pan-height.wav", import.meta.url));

// Native FFmpeg 7.0.2 output starts at these samples and increases by one per frame.
for (const [channel, firstSample] of [
  ["TFR", 3100], ["c3", 3100], ["TFL", 2100], ["c2", 2100], ["FL", 100], ["Bogus", null]
] as const) {
  for (const complex of [false, true]) {
    it(`selects extensible WAV height channels (${complex ? "graph" : "simple"}): ${channel}`, async () => {
      const volume = Volume.fromJSON({ "/height.wav": input, "/out.wav": "KEEP" });
      const filter = `pan=mono|c0=${channel}`;
      const filters = complex
        ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"]
        : ["-af", filter];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/height.wav", ...filters,
          "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.deepEqual(volume.readFileSync("/height.wav"), input);
      if (firstSample === null) {
        assert.equal(result.exitCode, 234);
        assert.ok(stderr.includes("pan: invalid channel Bogus"), stderr);
        assert.equal(volume.readFileSync("/out.wav", "utf8"), "KEEP");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.channels, 1);
      assert.equal(audio.sampleRate, 8000);
      assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768),
        Array.from({ length: 8 }, (_, frame) => firstSample + frame));
    });
  }
}
