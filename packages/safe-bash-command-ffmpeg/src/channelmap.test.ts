import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav, serializeWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const left = [101, 202, 303, 404, 505, 606];
const right = [-901, -802, -703, -604, -505, -406];
for (const [expression, expected, inputMask, raw, mask] of [
  ["0|1:USR17+USR18,channelmap=USR18", [right], undefined, true],
  ["0|1:USR18+USR17,channelmap=USR18", [left], undefined, true],
  ["0|1:USR0+USR1,channelmap=FR", [right], undefined, true],
  ["0|1:USR2147483647+USR1000", [left, right], undefined, true],
  ["0|1:USR1+USR0,channelmap=USR1", [left], undefined, true],
  ["0|1:USR999+USR1000", [left, right], undefined, true],
  ["0|1:FL+FR,channelmap=FL", [left], undefined, true],
  ["0|1:USR999+USR1000,anull,channelmap=USR1000", [right], undefined, true],
  ["FR|FL", [right, left]],
  ["FR|FL", [right, left], undefined, true],
  ["1|0", [right, left], undefined, true],
  ["0|0", [left, left], undefined, true],
  ["1|", [right]],
  ["1|:mono", [right]],
  ["1|0|", [right, left]],
  ["1|0|:stereo", [right, left]],
  ["map=1|:channel_layout=mono", [right]],
  ["map=1|0|:channel_layout=stereo", [right, left]],
  ["FR|FL|", [right, left]],
  ["1-0|0-1|", [right, left]],
  ["FR-FL|FL-FR|", [right, left]],
  ["|1", undefined],
  ["1||0", undefined],
  ["1||", undefined],
  ["1|:stereo", undefined],
  ["|", undefined],
  ["FR:mono,channelmap=FC", [right]],
  ["map=FR|FL:channel_layout=stereo", [right, left]],
  ["FR:mono", [right]],
  ["FL|FL", [left, left]],
  ["0|0", [left, left]],
  ["FC|LFE", [left, right], 12],
  ["LFE|FC", [right, left], 12],
  ["SR|SL", [right, left], 0x600],
  ["FL|FR", undefined, 12],
  ["FC|FL", undefined],
  ["invalid|FL", undefined],
  ["1|0|1", [right, left, right], undefined, undefined, 0x0b],
  ["0|1|1|0", [left, right, right, left], undefined, undefined, 0x107],
  ["0|1|0|1|0", [left, right, left, right, left], undefined, undefined, 0x37],
  ["0|1|0|1|0|1", [left, right, left, right, left, right], undefined, undefined, 0x3f],
  ["0|1|0|1|0|1|0", [left, right, left, right, left, right, left], undefined, undefined, 0x70f],
  ["0|1|0|1|0|1|0|1", [left, right, left, right, left, right, left, right], undefined, undefined, 0x63f],
  ["0-1|1-0", [right, left]],
  ["1-0|0-1", [right, left]],
  ["0-FR|1-FL", [right, left]],
  ["0-USR1|1-USR0", [right, left]],
  ["1-USR3|0-USR2", [left, right], undefined, undefined, 12],
  ["0-USR9|1-USR10", [left, right], undefined, undefined, 0x600],
  ["FL-1|FR-0", [right, left]],
  ["FL-FR|FR-FL", [right, left]],
  ["1-FR", [right], undefined, undefined, 2],
  ["0-FC|1-LFE", [left, right], undefined, undefined, 12],
  ["1-LFE|0-FC", [left, right], undefined, undefined, 12],
  ["0-0|1-0", undefined],
  ["FL-0|1-1", undefined],
  ["0-FL|1-1", undefined],
  ["0-0|1-2", undefined],
  ["0-1|1", undefined],
  ["0-FR:mono", undefined],
  ["map=1|0:channel_layout=stereo", [right, left]],
  ["1|0:stereo", [right, left]],
  ["1|0:0x3", [right, left]],
  ["1|0:3", [right, left]],
  ["1|0:FL+FR", [right, left]],
  ["1|0:2c", [right, left]],
  ["1:FR", [right], 2],
  ["0|1|1|0:quad", [left, right, right, left], 0x33],
  ["0|1|1|0:0x33", [left, right, right, left], 0x33],
  ["0|1|1|0:FL+FR+BL+BR", [left, right, right, left], 0x33],
  ["map=1|0:channel_layout=2c", [right, left]],
  ["0|1:mono", undefined],
  ["0|1:FL+FL", [left, right]],
  ["0|1:FL+FL,channelmap=FL", [left], undefined, true],
  ["0|1:FL+FL,channelmap=1", [right], undefined, true],
  ["0|1:FR+FR,channelmap=FR", [left], undefined, true],
  ["0|0|1:FL+FL+FR,anull,channelmap=FR", [right], undefined, true],
  ["0|1:FR+FR,pan=stereo|c0=c0|c1=c1,channelmap=FR", [right], undefined, true],
  ["0|1:FL+FR,channelmap=FL", [left], undefined, true],
  ["0-0|1-0:FL+FL", undefined],
  ["0|1:0x80000003", undefined],
  ["0|1:0", undefined],
  ["map=1|0", [right, left]],
  ["map=1:channel_layout=mono", [right]],
  ["map=1|0:channel_layout=stereo,areverse", [[...right].reverse(), [...left].reverse()]],
  ["map=0|1:channel_layout=stereo", [left, right]],
  ["channel_layout=stereo", [left, right]],
  ["channel_layout=mono", [left]],
  ["0|1:stereo", [left, right]],
  ["1:mono", [right]],
  ["map=0|1:channel_layout=mono", undefined],
  ["channel_layout=unknown", undefined],
  ["", undefined],
  ["map=6|0:channel_layout=stereo", undefined],
  ["map=-1|0:channel_layout=stereo", undefined],
  ["map=1.5|0:channel_layout=stereo", undefined],
  ["map=1:channel_layout=stereo", undefined]
] as const) {
  for (const complex of [false, true]) {
    it(`maps PCM channels (${complex ? "graph" : "simple"} ${raw ? "raw" : "WAV"}): ${expression}`, async () => {
      const volume = Volume.fromJSON({ "/out.wav": "keep" });
      volume.writeFileSync("/twins.wav", encodeWav({ sampleRate: 8000,
        channels: [left, right].map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
      if (inputMask !== undefined) {
        const doc = parseWav(volume.readFileSync("/twins.wav") as Buffer);
        volume.writeFileSync("/twins.wav", serializeWav({ ...doc, tracks: [{ ...doc.tracks[0]!,
          decodedAudio: { ...doc.tracks[0]!.decodedAudio!, channelMask: inputMask }
        }] }, { audioCodec: "pcm_s16le" }));
      }
      if (raw) {
        const bytes = Buffer.alloc(left.length * 4);
        for (const [frame, sample] of left.entries()) {
          bytes.writeInt16LE(sample, frame * 4);
          bytes.writeInt16LE(right[frame]!, frame * 4 + 2);
        }
        volume.writeFileSync("/twins.wav", bytes);
      }
      let stderr = "";
      const filter = expression ? `channelmap=${expression}` : "channelmap";
      const filters = complex
        ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"]
        : ["-af", filter];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", ...(raw ? ["-f", "s16le", "-ar", "8000", "-ac", "2"] : []),
          "-i", "/twins.wav", ...filters, "-c:a", "pcm_s16le", "/out.wav"],
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
        assert.equal(volume.readFileSync("/out.wav", "utf8"), expression === "map=6|0:channel_layout=stereo" ? "" : "keep");
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
