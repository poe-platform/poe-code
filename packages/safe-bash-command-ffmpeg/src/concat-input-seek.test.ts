import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// FFmpeg 7.0.2: duration-indexed concat seeks are sample-accurate. Seeking
// beyond EOF leaves the WAV demuxer at its final 512-frame packet.
for (const channels of [1, 2]) {
  for (const [seek, first, last = 16000, duration = 1, limit = []] of [
    [undefined, 0], ["0.27", 2160], ["1", 8000], ["1.256", 10048],
    ["1.27", 10160], ["1.999875", 15999], ["2.0", 16000], ["4.0", 15680],
    ["1.27", 10160, 11184, 1, ["-t", "0.1"]],
    ["1.27", 10160, 11184, 1, ["-to", "1.37"]],
    ["1.27", 14160, 16000, 0.5], ["2.27", 10160, 16000, 2]
  ] as const) {
    it(`concat input seek ${seek}, duration ${duration}, limit ${limit}, ${channels} channels`, async () => {
      const volume = Volume.fromJSON({
        "/list.ffconcat": `ffconcat version 1.0\nfile a.wav\nduration ${duration}\nfile b.wav\nduration 1\n`
      });
      const pcm = Buffer.alloc(16000 * channels * 2);
      for (const [name, base, offset] of [["a", 0, 0], ["b", 10000, 8000]] as const) {
        const audio = Array.from({ length: channels }, (_, channel) =>
          Float64Array.from({ length: 8000 }, (_, frame) => {
            const value = (base + frame) * (channel === 0 ? 1 : -1);
            pcm.writeInt16LE(value, ((offset + frame) * channels + channel) * 2);
            return value / 32768;
          }));
        volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 8000, channels: audio }));
      }
      const args = ["-v", "error", "-f", "concat", ...(seek ? ["-ss", seek] : []), ...limit,
        "-i", "/list.ffconcat", "-c", "copy", "-f", "s16le", "-"];
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        () => assert.fail("concat input must use the async path")), undefined);
      let stderr = "";
      const chunks: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const actual = Buffer.concat(chunks);
      const expected = pcm.subarray(first * channels * 2, last * channels * 2);
      assert.equal(actual.length, expected.length);
      assert.deepEqual(actual, expected);
    });
  }
}
