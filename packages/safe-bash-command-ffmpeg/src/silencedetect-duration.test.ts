import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const key of ["d", "duration"]) {
  for (const duration of ["125ms", "125000us", "0.125", "0.125s", "bad", "125badms", "-1ms", "86400001ms"]) {
    it(`silencedetect accepts native duration units and rejects invalid ${key}=${duration}`, async () => {
      // At 8 kHz, seven audible samples precede silence from 0.000875 to 0.5 seconds.
      const input = encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 4000 }, (_, index) => index < 7 ? 0.25 : 0)] });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.wav": "keep" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-y", "-v", "info", "-i", "/in.wav",
          "-af", `silencedetect=n=0.04:${key}=${duration}`, "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (["bad", "125badms", "-1ms", "86400001ms"].includes(duration)) {
        assert.equal(result.exitCode, ["-1ms", "86400001ms"].includes(duration) ? 222 : 234, stderr);
        assert.ok(stderr.includes("silencedetect: invalid duration"), stderr);
        assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(stderr.trim().split("\n").filter(line => line.includes("silence_")), [
          "silence_start: 0.000875",
          "silence_end: 0.5 | silence_duration: 0.499125"
        ]);
        assert.deepEqual(parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData,
          parseWav(input).tracks[0]!.decodedAudio!.channelData);
      }
    });
  }
}
