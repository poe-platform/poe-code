import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = [12000, -18000, 24000, -16000];
// FFmpeg 7.0.2 PCM16 output for this mono fixture at 8000 Hz.
const wet = [1080, -5735, 2106, -4942];

for (const graph of [false, true]) {
  for (const [filter, expected] of [
    ["asendcmd=c='0.00025 deesser enable 0',deesser=i=1", [...wet.slice(0, 2), ...input.slice(2)]],
    ["asendcmd=c='0 deesser enable 0',deesser=i=1", input],
    ["asendcmd=c='0 deesser enable 0;0.00025 deesser enable 1',deesser=i=1", [...input.slice(0, 2), ...wet.slice(2)]],
    ["asendcmd=c='0.00025 deesser@voice enable 0',deesser@voice=i=1", [...wet.slice(0, 2), ...input.slice(2)]],
    ["asendcmd=c='0 deesser@other enable 0',deesser@voice=i=1", wet],
    ["asendcmd=c='0 deesser i 0',deesser=i=1", wet],
    ["asendcmd=c='0 deesser enable 0;0.00025 deesser enable unknown',deesser=i=1", input],
    ["asendcmd=c='0 deesser enable gt(n,0)',deesser=i=1", [...input.slice(0, 2), ...wet.slice(2)]],
    ["deesser=i=1,asendcmd=c='0 deesser enable 0'", [...wet.slice(0, 2), ...input.slice(2)]],
    ["asendcmd=c='0 deesser enable gte(st(0,ld(0)+1),3);0.00025 deesser enable gte(st(0,ld(0)+1),3)',deesser=i=1", input],
    ["asendcmd=c='0 deesser enable gte(st(0,ld(0)+1),3);0.00025 deesser enable unknown',deesser=i=1", [...input.slice(0, 2), ...wet.slice(2)]],
    // A bare target delivers the command to the first matching filter only.
    ["asendcmd=c='0 deesser enable 0',deesser=i=1,deesser=i=1", wet]
  ] as const) {
    it(`deesser applies ${filter} at frame boundaries (graph=${graph})`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [Float64Array.from(input, value => value / 32768)] }));
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]asetnsamples=n=2:p=0,${filter}[out]`, "-map", "[out]"]
          : ["-af", `asetnsamples=n=2:p=0,${filter}`]), "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const pcm = Buffer.concat(stdout);
      assert.equal(pcm.length, expected.length * 2);
      assert.deepEqual(expected.map((_, index) => pcm.readInt16LE(index * 2)), expected);
      if (!filter.includes("unknown")) assert.equal(stderr, "");
    });
  }
}
