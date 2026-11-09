import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const left = [1000, 2000, 3000, 4000];
const right = [-8000, -6000, -4000, -2000];

for (const graph of [false, true]) {
  for (const [filter, expected, mask] of [
    ["channelsplit=channels=FL", left, 1],
    ["channelsplit=channels=FR", right, 2],
    ["channelsplit=channels=FL,aformat=channel_layouts=mono", left, 0],
    ["channelsplit=channels=FR,aformat=channel_layouts=mono", right, 0],
    ["channelsplit=channels=FL,aformat=cl=mono", left, 0],
    ["channelsplit=channels=FR,aformat=cl=mono", right, 0],
    ["aformat=channel_layouts=mono", [-3500, -2000, -500, 1000], 0]
  ] as const) {
    it(`preserves selected samples and WAV layout for ${filter} (graph=${graph})`, async () => {
      const volume = Volume.fromJSON({ "/out.wav": "keep" });
      volume.writeFileSync("/in.wav", encodeWav({
        sampleRate: 8000,
        channels: [left, right].map(samples => Float64Array.from(samples, sample => sample / 32768))
      }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
      assert.equal(result.exitCode, 0, stderr);
      const bytes = volume.readFileSync("/out.wav") as Buffer;
      const audio = parseWav(bytes).tracks[0]!.decodedAudio!;
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channels, 1);
      assert.deepEqual(Array.from(audio.channelData[0]!, sample => sample * 32768), expected);
      let offset = 12;
      while (offset < bytes.length && bytes.toString("ascii", offset, offset + 4) !== "fmt ") {
        const size = bytes.readUInt32LE(offset + 4);
        offset += 8 + size + size % 2;
      }
      assert.equal(bytes.toString("ascii", offset, offset + 4), "fmt ");
      assert.equal(bytes.readUInt16LE(offset + 8), mask ? 0xfffe : 1);
      if (mask) assert.equal(bytes.readUInt32LE(offset + 28), mask);
    });
  }
}
