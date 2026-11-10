import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [101, -901, 202, -802, 303, -703];
// PCM and failure status for the reported cases were checked against FFmpeg 7.0.2.
for (const [filter, exitCode, expected] of [
  ["channelmap=0|1:0C", 1, undefined],
  ["channelmap=0|1:2147483647C", 1, undefined],
  ["channelmap=0|1:2.5C", 1, undefined],
  ["channelmap=0|1:2C,channelmap=", 1, undefined],
  ["channelmap=0-:2C", 1, undefined],
  ["channelmap=0|1:2C,channelmap=c0", 1, undefined],
  ["pan=|c0=c0", 1, undefined],
  ["pan=+|c0=c0", 1, undefined],
  ["pan=0C|c0=c0", 1, undefined],
  ["pan=2147483647C|c0=c0", 1, undefined],
  ["pan=2C|FL=c0", 1, undefined],
  ["pan=2C|=c0", 1, undefined],
  ["channelmap=FR|FL:2C", 0, [-901, 101, -802, 202, -703, 303]],
  ["channelmap=FR|FL:2 channels", 0, [-901, 101, -802, 202, -703, 303]],
  ["pan=2C|c0=c1|c1=c0", 0, [-901, 101, -802, 202, -703, 303]],
  ["pan=2 channels|c0=c1|c1=c0", 0, [-901, 101, -802, 202, -703, 303]],
  ["channelmap=0|1:2C,channelmap=FL", 234, []],
  ["channelmap=0|1:2c,channelmap=FL", 0, [101, 202, 303]],
  ["pan=2C|c0=c0|c1=c1,channelmap=FL", 234, []],
  ["channelmap=0|1:2C,channelmap=1", 0, [-901, -802, -703]],
  ["channelmap=0|1:2C,pan=mono|c0=c1", 0, [-901, -802, -703]],
  ["channelmap=channel_layout=2C", 0, samples],
  ["channelmap=0-1|1-0:2C", 0, [-901, 101, -802, 202, -703, 303]],
  ["channelmap=1:1C", 0, [-901, -802, -703]],
  ["pan=1C|c0=c1", 0, [-901, -802, -703]],
  ["channelmap=0|1:2C,channelmap=0|1:2c,channelmap=FL", 0, [101, 202, 303]]
] as const) {
  for (const complex of [false, true]) {
    it(`handles count-only layouts (${complex ? "graph" : "simple"}): ${filter}`, async () => {
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
      const volume = Volume.fromJSON({ "/in.raw": input });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, exitCode, stderr);
      if (expected === undefined) {
        assert.equal(volume.existsSync("/out.raw"), false);
        return;
      }
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)), expected);
      if (exitCode !== 0) assert.match(stderr, /channelmap: unavailable input channel FL/);
    });
  }
}
