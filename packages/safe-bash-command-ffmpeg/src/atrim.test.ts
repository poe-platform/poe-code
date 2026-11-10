import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const channels of [1, 2]) {
  for (const [filter, start, end, exitCode = 234] of [
    ["atrim=start_sample=-1", 0, 16000],
    ["atrim=start_sample=-1:end_sample=3", 0, 3],
    ["atrim=start_sample=-2", -1, 0, 222],
    ["atrim=end_sample=-1", -1, 0, 222],
    ["atrim=start_sample=-1.1", -1, 0, 222],
    ["atrim=end_sample=-0.1", -1, 0, 222],
    ["atrim=start_sample=1.5", 2, 16000],
    ["atrim=start_sample=2.5:end_sample=8", 2, 8],
    ["atrim=start_sample=3.5:end_sample=8", 4, 8],
    ["atrim=start_sample=2+2:end_sample=8", 4, 8],
    ["atrim=start_sample=4:end_sample=8", 4, 8],
    ["atrim=end_sample=2+2", 0, 4],
    ["atrim=end_sample=2.5", 0, 2],
    ["atrim=end_sample=3.5", 0, 4],
    ["atrim=start_sample=invalid", -1, 0],
    ["atrim=start_sample=1/0", -1, 0, 222],
    ["atrim=end_sample=", -1, 0],
    ["atrim=start=0.000625:start_sample=-1:end_sample=8", 5, 8],
    ["atrim=start_sample=5:start_sample=-1:end_sample=8", 0, 8],
    ["atrim=start=invalid", -1, 0],
    ["atrim=end=", -1, 0],
    ["atrim=unknown=1", -1, 0, 8],
    ["atrim=duration=-0.0005", -1, 0, 222],
    ["atrim=duration=invalid", -1, 0],
    ["atrim=durationi=", -1, 0],
    ["atrim=duration=0", 0, 16000],
    ["atrim=duration=1us", 0, 16000],
    ["atrim=start_sample=2:duration=0", 2, 16000],
    ["atrim=duration=0.0005", 0, 4],
    ["atrim=start_sample=2:duration=0.0005", 2, 6],
    ["atrim=start_sample=2:durationi=0.0005", 2, 6],
    ["atrim=start=0.00025:duration=500us", 2, 6],
    ["atrim=start_sample=2:duration=0.5ms:end_sample=10", 2, 10],
    ["atrim=start_sample=2:duration=0.0005:end_sample=4", 2, 6],
    ["atrim=start_sample=2:duration=0.0005:end=0.00125", 2, 10],
    ["atrim=start_sample=2:duration=0.0005:end=0.0005", 2, 6],
    ["atrim=start_sample=2:duration=0:end_sample=4", 2, 4],
    ["atrim=start_sample=2:duration=0.001:durationi=0.0005", 2, 6],
    ["atrim=start_sample=2:durationi=0.0005:duration=0.001", 2, 10],
    ["atrim=start_sample=2:duration=0.0005:durationi=0", 2, 16000],
    ["atrim=start=0.001:start_sample=2:duration=0.0005", 2, 6],
    ["atrim=start_sample=2,atrim=duration=0.0005", 2, 6],
    ["atrim=start_sample=15999:duration=0.0005", 15999, 16000],
    ["atrim=start_sample=17000:duration=0.0005", 16000, 16000],
    ["anull", 0, 16000],
    ["atrim", 0, 16000],
    ["atrim=start_sample=2025:end_sample=3123", 2025, 3123],
    ["atrim=start_sample=2:start_sample=5:end_sample=8", 5, 8],
    ["atrim=start_sample=5:start_sample=2:end_sample=8", 2, 8],
    ["atrim=end_sample=8:end_sample=4", 0, 4],
    ["atrim=end_sample=4:end_sample=8", 0, 8],
    ["atrim=start=0.00025:start=0.000625:end_sample=8", 5, 8],
    ["atrim=start=0.000625:start=0.00025:end_sample=8", 2, 8],
    ["atrim=end=0.001:end=0.0005", 0, 4],
    ["atrim=end=0.0005:end=0.001", 0, 8],
    ["atrim=0.00025:0.001:start=0.000625:end=0.000875", 5, 7],
    ["atrim=start=0.00025:start_sample=5:end_sample=8", 2, 8],
    ["atrim=start_sample=1:start=0.00025:start_sample=5:end_sample=8:end=0.0005:end_sample=6", 2, 6],
    ["atrim=start_sample=-1:start_sample=5", 5, 16000],
    ["atrim=start=0.253:end=0.390", 2024, 3120],
    ["atrim=start_sample=15999", 15999, 16000],
    ["atrim=end_sample=1", 0, 1],
    ["atrim=start_sample=10:end_sample=10", 10, 10],
    ["atrim=start_sample=17000", 16000, 16000],
    ["atrim=start=0.253:start_sample=2025:end=0.390:end_sample=3123", 2024, 3123],
    ["atrim=start_sample=2000,atrim=start=0.253:end=0.390", 2024, 3120],
    ["atrim=start_sample=2000,atrim=start_sample=25:end_sample=1123", 2025, 3123]
  ] as const) {
    it(`${filter} preserves exact PCM with ${channels} channels`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: Array.from({ length: channels }, (_, c) =>
        Float64Array.from({ length: 16000 }, (_, i) => (c ? -i : i) / 32768)) });
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
        assert.equal(result.exitCode, exitCode, stderr);
        assert.ok(stderr.includes("atrim:"), stderr);
        assert.equal(volume.readFileSync("/out.wav", "utf8"), "existing");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      const original = parseWav(input).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channelData.length, channels);
      for (let c = 0; c < channels; c++) {
        assert.deepEqual(audio.channelData[c], original.channelData[c]!.slice(start, end));
      }
    });
  }
}
