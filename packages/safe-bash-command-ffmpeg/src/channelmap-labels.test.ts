import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [101, -901, 202, -802, 303, -703];
for (const [filter, expected] of [
  ["channelmap=0|1:FL@left+FR@right,channelmap=FR", [-901, -802, -703]],
  ["channelmap=0|1:FR@right+FL@left", samples],
  ["channelmap=map=FR:channel_layout=FR,channelmap=FR", [-901, -802, -703]],
  ["channelmap=0|1:FR@right+FL@left,channelmap=FR", [101, 202, 303]],
  ["channelmap=0|1:FR@right+FL@left,channelmap=FL", [-901, -802, -703]],
  ["channelmap=map=FL-FR|FR-FL:channel_layout=FR@right+FL@left", samples],
  ["channelmap=0|1:FL+FR@right,channelmap=FR", [-901, -802, -703]],
  ["channelmap=0|1:FL@left+INVALID@right", undefined],
  ["channelmap=0|1:FL@left+@right", undefined]
] as const) {
  for (const complex of [false, true]) {
    it(`resolves labeled layout speakers (${complex ? "graph" : "simple"}): ${filter}`, async () => {
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
      if (!expected) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.existsSync("/out.raw"), false);
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)), expected);
    });
  }
}
