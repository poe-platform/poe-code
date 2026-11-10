import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const right = [-901, -802, -703];
const cases: [string, number[]][] = [
  ["channelmap=0|1:DL+DR,channelmap=DR", right],
  ["channelmap=0|1:0x60000000,channelmap=DR", right],
  ["channelmap=1-LFE2", right],
  ["pan=DL+DR|DL=FR|DR=FL", [-901, 101, -802, 202, -703, 303]],
  ["channelmap=1-TFL,channelmap=TFL", right]
];
for (const [name, bit] of [["DL", 29], ["DR", 30], ["WL", 31], ["WR", 32],
  ["SDL", 33], ["SDR", 34], ["LFE2", 35], ["TSL", 36], ["TSR", 37],
  ["BFC", 38], ["BFL", 39], ["BFR", 40]] as const) {
  cases.push([`channelmap=1-${name},channelmap=${name}`, right],
    [`channelmap=1:0x${(2 ** bit).toString(16)},channelmap=${name}`, right],
    [`channelmap=1-${name},pan=mono|FC=${name}`, right]);
}
for (const [filter, expected] of cases) {
  for (const graph of [false, true]) {
    it(`routes extended speakers: ${filter} (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(12);
      [101, -901, 202, -802, 303, -703].forEach((value, i) => input.writeInt16LE(value, i * 2));
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.raw", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
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
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
    });
  }
}
