import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Two 2x2 gray frames at the default 25 fps; reported outputs match native FFmpeg.
for (const [filter, expected] of [
  ["sendcmd='0.04 hflip enable 0',hflip", "140d221b2930373e"],
  ["hflip=enable='lt(n,1)'", "140d221b2930373e"],
  ["sendcmd='0.04 vflip@mirror enable 1',vflip@mirror=enable=0", "0d141b22373e2930"],
  ["vflip=enable='gte(n,1)'", "0d141b22373e2930"],
  ["sendcmd='0.041 hflip enable 0',hflip", "140d221b30293e37"],
  ["sendcmd='0.04 hflip@other enable 0',hflip@mirror", "140d221b30293e37"],
  ["sendcmd='0.04 hflip enable 0',hflip@first,hflip@second", "0d141b2230293e37"],
  ["sendcmd='0.04 vflip@second enable 0',vflip@first,vflip@second", "0d141b22373e2930"],
  ["sendcmd='0 hflip enable 0;0.04 hflip enable gte(n,1)',hflip", "0d141b2230293e37"],
  ["sendcmd='0 hflip enable invalid;0.04 hflip enable 0',hflip", "140d221b2930373e"],
  ["sendcmd='0 vflip enable 0;0.04 vflip enable invalid',vflip", "0d141b222930373e"],
  ["setpts=PTS+1/TB,sendcmd='1.04 vflip enable 0',vflip", "1b220d142930373e"]
] as const) {
  for (const graph of [false, true]) {
    it(`timed flip (${graph ? "graph" : "simple"}): ${filter}`, async () => {
      const input = Buffer.from("0d141b222930373e", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input });
      const stdout: Uint8Array[] = [];
      const stderr: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
      assert.equal(Buffer.concat(stdout).toString("hex"), expected);
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
