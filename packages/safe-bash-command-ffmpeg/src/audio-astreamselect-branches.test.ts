import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const [graph, expected] of [
  ["[0:a]volume=0.5[x];[x][1:a]astreamselect=map=0[out]", 4000],
  ["[0:a]volume=0.5[x];[x][1:a]astreamselect=map=1[out]", -4000],
  ["[1:a]volume=0.5[x];[0:a][x]astreamselect=map=1[out]", -2000],
  ["[1:a]volume=0.5[x];[0:a][x]astreamselect=map=0[out]", 8000],
  ["[0:a]anull[x];[x][1:a]astreamselect=map=0[out]", 8000],
  ["[0:a]volume=0.5[x];[1:a]volume=0.25[y];[x][y]astreamselect=map=1,volume=0.5[out]", -500]
] as const) {
  for (const channels of [1, 2]) {
    it(`applies branch filters before ${graph}, channels=${channels}`, async () => {
      const volume = Volume.fromJSON({});
      for (const [name, value] of [["a", 8000], ["b", -4000]] as const) {
        volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000,
          channels: Array.from({ length: channels }, (_, channel) =>
            new Float64Array(2048).fill((channel === 0 ? value : -value) / 32768)) }));
      }
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/a.wav", "-i", "/b.wav",
          "-filter_complex", graph, "-map", "[out]", "-c:a", "pcm_s16le", "/out.wav"],
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
      assert.equal(audio.sampleRate, 8000);
      assert.equal(audio.channels, channels);
      for (const [index, channel] of audio.channelData.entries()) {
        assert.equal(channel.length, 2048);
        assert.deepEqual(Array.from(channel, sample => sample * 32768),
          Array(2048).fill(index === 0 ? expected : -expected));
      }
    });
  }
}
