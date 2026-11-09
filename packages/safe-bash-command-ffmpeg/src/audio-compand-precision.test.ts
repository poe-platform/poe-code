import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg references: tiny flat gain must survive float output, and
// curved gain must reach PCM16 rounding without an intermediate float32 cast.
for (const [filter, input, expected] of [
  ["compand=gain=0:points=0/0", -25000 / 32768, -25000 / 32768],
  ["compand=gain=0.0000001:points=0/0", -25000 / 32768, -0.7629394619086651],
  ["compand=attacks=0:decays=0:soft-knee=4:points=-60/-60|-6/-12|0/0", -12367 / 32768, -0.20146178807744564]
] as const) {
  for (const graph of [false, true]) {
    for (const format of ["f64le", "s16le"]) {
      it(`preserves compand gain through ${format} encoding: ${filter} (${graph ? "graph" : "simple"})`, async () => {
        const fs = Volume.fromJSON({});
        fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [new Float64Array([input])] }));
        const errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-i", "/in.wav", ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", format, "/out.pcm"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
          stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        const output = fs.readFileSync("/out.pcm") as Buffer;
        assert.equal(output.length, format === "f64le" ? 8 : 2);
        if (format === "f64le") assert.ok(Math.abs(output.readDoubleLE() - expected) <= 2e-16);
        else assert.equal(output.readInt16LE(), Math.round(expected * 32768));
      });
    }
  }
}
