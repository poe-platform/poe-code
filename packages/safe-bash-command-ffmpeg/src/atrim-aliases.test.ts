import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const channels of [1, 2]) {
  for (const [filter, start, end] of [
    ["atrim=starti=0.00025:endi=0.001", 2, 8],
    ["atrim=starti=0.00025", 2, 16],
    ["atrim=endi=0.001", 0, 8],
    ["atrim=starti=250us:end=1ms", 2, 8],
    ["atrim=start=250us:endi=1ms", 2, 8],
    ["atrim=starti=0.00025:start_sample=4:endi=0.00075:end_sample=8", 2, 8],
    ["atrim=start=0.00025:starti=0.0005:endi=0.001", 4, 8],
    ["atrim=starti=0.0005:start=0.00025:endi=0.001", 2, 8],
    ["atrim=starti=0.00025:end=0.001:endi=0.00075", 2, 6],
    ["atrim=starti=0.00025:endi=0.00075:end=0.001", 2, 8],
    ["atrim=starti=invalid", -1, 0],
    ["atrim=endi=", -1, 0]
  ] as const) {
    it(`${filter} handles duration aliases with ${channels} channels`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: Array.from({ length: channels }, (_, c) =>
        Float64Array.from({ length: 16 }, (_, i) => (c ? -1 : 1) * (i + 1) / 32768)) });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.wav": "existing" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", "-af", filter, "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (start === -1) {
        assert.equal(result.exitCode, 234, stderr);
        assert.ok(stderr.includes("atrim: invalid"), stderr);
        assert.equal(volume.readFileSync("/out.wav", "utf8"), "existing");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channelData.length, channels);
      for (let c = 0; c < channels; c++) {
        assert.deepEqual(Array.from(audio.channelData[c]!, value => value * 32768),
          Array.from({ length: end - start }, (_, i) => (c ? -1 : 1) * (start + i + 1)));
      }
    });
  }
}
