import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: ffmpeg -v error -i in.wav -af compand=OPTIONS -f s32le pipe:1
// The mono PCM16 fixture contains the eight samples below at 8000 Hz.
for (const [options, expected] of [
  ["gain=0:volume=-30:0.2", "f33593003b8021fb4ebe2b1325f7108dffffff7f00000080a054d77089aec203"],
  ["gain=0:volume=-30:attacks=0.2", "f33593003b8021fb4ebe2b1325f7108dffffff7f00000080a054d77089aec203"],
  ["0.2:gain=0:volume=-30:0.4", "d9399300cc4121fb5cf82c13ba9f098dffffff7f00000080cc53de70af01c303"],
  ["attacks=0:gain=0:volume=-30:0.2", "a7419300e5c420fb8d6c2f13436eb7c7568c1075593e8ab0eb9f8d0c45216b00"],
  ["0.2:gain=0:volume=-30:attacks=0", "f33593003b8021fb4ebe2b13436eb7c7568c10755d4d8cb050658c0c2d0e6b00"],
  ["gain=0:0.2:volume=-30:0.4", "a7419300e5c420fb8d6c2f137f34ef8cffffff7f000000806db205721109cd03"],
  ["decays=0.4:volume=-30:0.2:0.6", "403793006c6b21fbfc262c13b1840e8dffffff7f00000080aba9d97040cac203"],
  ["0.2:0.4:-70/-70|-60/-20|1/0:0.01:0:-30:0", "d9399300cc4121fb5cf82c13ba9f098dffffff7f00000080cc53de70af01c303"]
] as const) {
  for (const graph of [false, true]) {
    it(`binds compand=${options} like native FFmpeg (${graph ? "graph" : "simple"})`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from([15, -127, 500, -3000, 28000, -19003, 3001, 100], sample => sample / 32768)
      ] }));
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const filter = `compand=${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s32le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
        stdin: (async function* () {})(), stdout: { async write(b: Uint8Array) { output.push(b); } }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.equal(Buffer.concat(errors).length, 0);
      assert.equal(Buffer.concat(output).toString("hex"), expected);
    });
  }
}
