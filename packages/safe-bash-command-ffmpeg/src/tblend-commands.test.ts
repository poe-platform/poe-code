import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [[50, 30, 212], [120, 180, 60], [120, 180, 60], [80, 140, 190]];
const input = Buffer.concat([
  Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
  ...samples.flatMap(frame => [Buffer.from("FRAME\n"), ...frame.map(value => Buffer.alloc(4, value))])
]);
const difference = [[70, 150, 152], [0, 0, 0], [40, 40, 130]];
// FFmpeg 7.0.2: retain the first blended frame, then emit the input unchanged.
const switched = [difference[0]!, ...samples.slice(2)];

for (const [filter, expected] of [
  ["trim=start_frame=1", samples.slice(1)],
  ["tblend=all_mode=difference:enable=0", samples.slice(1)],
  ["tblend=all_mode=difference:enable='gte(n,2)'", [samples[1]!, ...difference.slice(1)]],
  ["tblend=all_mode=difference:enable='gte(t,0.5)'", [samples[1]!, ...difference.slice(1)]],
  ["tblend=all_mode=difference:enable='eq(n,3)'", [...samples.slice(1, 3), difference[2]!]],
  ["tblend=all_mode=difference:enable=1", difference],
  ["tblend=all_mode=difference:enable='gte(n,2)',select='eq(t,0.75)'", [difference[2]!]],
  ["sendcmd=c='0.5 tblend all_mode average',tblend=all_mode=difference:enable='eq(n,3)'",
    [...samples.slice(1, 3), [100, 160, 125]]],
  ["tblend=enable=0", samples.slice(1)],
  ["tblend=all_mode=difference:enable=0.25", samples.slice(1)],
  ["tblend=all_mode=difference:enable=-1", difference],
  ["tblend=all_mode=difference:enable=invalid", null],
  ["trim=end_frame=1,tblend=all_mode=difference:enable=invalid", null],
  ["sendcmd=c='0.50 tblend all_mode normal',tblend=all_mode=difference", switched],
  ["sendcmd=c='0.50 tblend@mix all_mode normal',tblend@mix=all_mode=difference", switched],
  ["sendcmd=c='0.50 tblend all_mode 0',tblend@mix=all_mode=difference", switched],
  ["sendcmd=c='0.51 tblend all_mode normal',tblend=all_mode=difference", [...difference.slice(0, 2), samples[3]!]],
  ["sendcmd=c='0 tblend all_mode normal',tblend=all_mode=difference", samples.slice(1)],
  ["sendcmd=c='1 tblend all_mode normal',tblend=all_mode=difference", difference],
  ["sendcmd=c='0.50 tblend@other all_mode normal',tblend@mix=all_mode=difference", difference],
  ["sendcmd=c='0.50 tblend all_mode invalid',tblend=all_mode=difference", difference],
  ["sendcmd=c='0.50 tblend all_mode -1;0.75 tblend all_mode 40',tblend=all_mode=difference", difference],
  ["sendcmd=c='0.75 tblend all_mode difference;0.50 tblend all_mode normal',tblend=all_mode=difference",
    [difference[0]!, samples[2]!, difference[2]!]],
  ["sendcmd=c='0.50 tblend all_mode normal',tblend@a=all_mode=difference,tblend@b=all_mode=difference",
    [[50, 30, 92], [40, 40, 130]]],
  ["sendcmd=c='0.50 tblend@b all_mode normal',tblend@a=all_mode=difference,tblend@b=all_mode=difference",
    difference.slice(1)],
  ["sendcmd=c='bad tblend all_mode normal',tblend=all_mode=difference", null]
] as const) {
  for (const graph of [false, true]) {
    it(`timed tblend (${graph ? "graph" : "simple"}): ${filter}`, async () => {
      const volume = Volume.fromJSON({ "/in.y4m": input, "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m", ...(graph
          ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
        "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (expected === null) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"),
          Buffer.from(expected.flatMap(frame => frame.flatMap(value => Array(4).fill(value)))));
      }
      assert.deepEqual(volume.readFileSync("/in.y4m"), input);
    });
  }
}
