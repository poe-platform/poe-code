import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const left = [1000, 2000, 3000, 4000];
const right = [-4000, -3000, -2000, -1000];
for (const [expression, expected, mask] of [
  ["0-1|1-0", [right, left]],
  ["1-0|0-1", [right, left]],
  ["0-FR|1-FL", [right, left]],
  ["FL-1|FR-0", [right, left]],
  ["FL-FR|FR-FL", [right, left]],
  ["1-FR", [right], 2],
  ["0-FC|1-LFE", [left, right], 12],
  ["1-LFE|0-FC", [left, right], 12],
  ["0-0|1-0", undefined],
  ["FL-0|1-1", undefined],
  ["0-FL|1-1", undefined],
  ["0-0|1-2", undefined],
  ["0-1|1", undefined],
  ["0-FR:mono", undefined],
  ["map=1|0:channel_layout=stereo", [right, left]],
  ["1|0:stereo", [right, left]],
  ["map=1|0", [right, left]],
  ["map=1:channel_layout=mono", [right]],
  ["map=1|0:channel_layout=stereo,areverse", [[...right].reverse(), [...left].reverse()]],
  ["map=0|1:channel_layout=stereo", [left, right]],
  ["map=6|0:channel_layout=stereo", undefined],
  ["map=-1|0:channel_layout=stereo", undefined],
  ["map=1.5|0:channel_layout=stereo", undefined],
  ["map=1:channel_layout=stereo", undefined]
] as const) {
  for (const complex of [false, true]) {
    it(`maps PCM channels (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const volume = Volume.fromJSON({ "/out.wav": "keep" });
      volume.writeFileSync("/twins.wav", encodeWav({ sampleRate: 8000,
        channels: [left, right].map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
      let stderr = "";
      const filters = complex
        ? ["-filter_complex", `[0:a]channelmap=${expression}[s]`, "-map", "[s]"]
        : ["-af", `channelmap=${expression}`];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/twins.wav", ...filters, "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (!expected) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
      if (mask !== undefined) {
        assert.equal(audio.channelMask, mask);
        const wav = volume.readFileSync("/out.wav") as Buffer;
        const fmt = wav.indexOf("fmt ");
        assert.equal(wav.readUInt16LE(fmt + 8), 0xfffe);
        assert.equal(wav.readUInt32LE(fmt + 28), mask);
      }
      assert.equal(audio.channels, expected.length);
      assert.equal(audio.sampleRate, 8000);
      assert.deepEqual(audio.channelData.map(channel => Array.from(channel, sample => sample * 32768)), expected);
    });
  }
}
