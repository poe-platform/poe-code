import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [101, -901, 202, -802, 303, -703];
for (const [filter, expected, exitCode = 0] of [
  ["channelmap=0|1:FR+FL,channelmap=FL", [-901, -802, -703]],
  ["channelmap=0|1:FR+FL,channelmap=FR", [101, 202, 303]],
  ["channelmap=map=FL-FR|FR-FL:channel_layout=FR+FL", samples],
  ["channelmap=0|1:FL+FR,channelmap=FL", [101, 202, 303]],
  ["channelmap=0|1:FR+FL,areverse,channelmap=FL", [-703, -802, -901]],
  ["channelmap=0|1:FR+FL,channelmap=0", [101, 202, 303]],
  ["channelmap=0|1:FR+FL,pan=mono|c0=FL", [101, 202, 303]],
  ["channelmap=0|1:FR+FL,pan=mono|c0=FR", [-901, -802, -703]],
  ["channelmap=0|1:FR+FL,pan=mono|c0=c1", [-901, -802, -703]],
  ["channelmap=0|1:FR+FL,pan=mono|c0=FL+FR", [-800, -600, -400]],
  ["channelmap=0|1:FL+FR,pan=mono|c0=FL", [101, 202, 303]],
  ["channelmap=0|1:FC+LFE,pan=mono|c0=FL", [0, 0, 0]],
  ["channelmap=0|1:BL+BR,pan=mono|c0=FL", [0, 0, 0]],
  ["channelmap=0|1:FR+FL,pan=stereo|c0=FL|c1=FR", [], 234],
  ["channelmap=0|1:FR+FL,channelmap=0|1:stereo,channelmap=FL", [101, 202, 303]],
  ["channelmap=0|1:FR+FL,pan=stereo|c0=c0|c1=c1,channelmap=FL", [], 234],
  ["channelmap=1|0:FR+FL,pan=stereo|c0=FL|c1=FR", [], 234],
  ["channelmap=1|0:FL+FR,pan=stereo|c0=FL|c1=FR", [-901, 101, -802, 202, -703, 303]],
  ["channelmap=0|1:FR+FR,pan=stereo|c0=c0|c1=c1,channelmap=FR", [], 234],
  ["channelmap=0|1:FR+FL,channelmap=0|1:stereo,pan=stereo|c0=FL|c1=FR", samples]
] as const) {
  for (const complex of [false, true]) {
    it(`preserves speaker order (${complex ? "graph" : "simple"}): ${filter}`, async () => {
      const volume = new Volume();
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
      volume.writeFileSync("/in.raw", input);
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
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)), expected);
    });
  }
}
