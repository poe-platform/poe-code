import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete PCM16 impulse responses from native FFmpeg 7.0.2 at 8000 Hz.
const integer = [973, -54, -52, -50, -49, -47, -46, -44];
const floating = [974, -54, -53, -51, -49, -48, -46, -45];
for (const [filter, expected] of [
  ["highpass=f=50", integer],
  ["highpass=f=50,volume=1", floating],
  ["highpass=f=50,volume=1:precision=double", floating],
  ["highpass=f=50,volume=1:precision=fixed", integer],
  ["highpass=f=50,volume=1:precision=1+0", floating],
  ["highpass=f=50,volume=1:precision=1/2", integer],
  ["highpass=f=50,volume=1:2", floating],
  ["highpass@cut=f=50,volume@gain=1", floating],
  ["highpass=f=50,anull,atrim=start_sample=0,asetpts=PTS,asetnsamples=n=4:p=0,apad=pad_len=0,volume=1", floating],
  ["aformat=fltp,highpass=f=50,volume=1", floating],
  ["aformat=s16p,highpass=f=50,volume=1", integer],
  ["aformat=s16,highpass=f=50,volume=1", floating],
  ["highpass=f=50,aformat=s16p,volume=1", integer],
  ["highpass=f=50,aformat=s16,volume=1", integer],
  ["highpass=f=50,aformat=fltp,volume=1", floating]
] as const) {
  for (const graph of [false, true]) {
    it(`negotiates highpass precision for ${filter} (graph=${graph})`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.from([1001, 0, 0, 0, 0, 0, 0, 0], sample => sample / 32768)] });
      const fs = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = fs.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
    });
  }
}
