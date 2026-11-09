import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const key of ["m", "mono", "positional"]) {
  for (const [value, mono] of [
    ["1", true], ["true", true], ["TRUE", true], ["TrUe", true],
    ["YES", true], ["ON", true], ["0", false], ["false", false],
    ["FALSE", false], ["FaLsE", false], ["NO", false], ["OFF", false],
    ["Perhaps", undefined], ["2", undefined]
  ] as const) {
    it(`silencedetect accepts case-insensitive booleans and rejects invalid ${key}=${value}`, async () => {
      // Seven audible samples precede the reported silence at 8 kHz.
      const input = encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 4000 }, (_, index) => index < 7 ? 0.25 : 0)] });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.wav": "keep" });
      const filter = key === "positional" ? `silencedetect=0.04:0.125:${value}`
        : `silencedetect=n=0.04:d=0.125:${key}=${value}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-y", "-v", "info", "-i", "/in.wav",
          "-af", filter, "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
      if (mono === undefined) {
        assert.equal(result.exitCode, 1, stderr);
        assert.ok(stderr.includes("silencedetect: invalid mono"), stderr);
        assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const prefix = mono ? "channel: 0 | " : "";
        assert.deepEqual(stderr.trim().split("\n").filter(line => line.includes("silence_")), [
          `${prefix}silence_start: 0.000875`,
          `${prefix}silence_end: 0.5 | silence_duration: 0.499125`
        ]);
        assert.deepEqual(parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData,
          parseWav(input).tracks[0]!.decodedAudio!.channelData);
      }
    });
  }
}
