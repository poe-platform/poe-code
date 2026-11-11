import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const wav = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(
  [-30000, -16385, -3, -1, 1, 3, 16385, 30000], value => value / 32768
)] });

async function run(filter: string) {
  const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
  fs.writeFileSync("/in.wav", wav);
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", "-af", filter, "-f", "s16le", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(p: string) { return fs.readFileSync(p); },
      async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); },
      async stat(p: string) { return fs.statSync(p); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(b: Uint8Array) { errors.push(b); } }
  } as never);
  return { code: result.exitCode, output: fs.readFileSync("/out.raw") as Buffer, error: Buffer.concat(errors).toString() };
}

for (const key of ["precision", "eval", "replaygain", "replaygain_preamp"]) {
  for (const value of ["min", "max", "default", "min+(max-min)/2"]) {
    it(`resolves option-local volume ${key}=${value}`, async () => {
      const result = await run(`volume=.501:${key}=${value}`);
      assert.equal(result.code, 0, result.error);
      // FFmpeg 7.0.2 native PCM16 output; fixed precision rounds the gain to Q8.
      assert.equal(result.output.toString("hex"), key === "precision" && value === "min"
        ? "68c500e0ffff0000010002000120983a" : "4ac5efdffeffffff010002001120b63a");
    });
  }
  for (const value of ["min-1", "max+1"]) {
    it(`rejects out-of-range volume ${key}=${value} without replacing output`, async () => {
      const result = await run(`volume=.501:${key}=${value}`);
      assert.equal(result.code, 1);
      assert.equal(result.output.toString(), "KEEP");
    });
  }
}

for (const [value, mode] of [["min", "fixed"], ["max", "double"], ["default", "float"]]) {
  it(`negotiates upstream precision for volume precision=${value}`, async () => {
    const expected = await run(`highpass=f=200,volume=.501:precision=${mode}`);
    const actual = await run(`highpass=f=200,volume=.501:precision=${value}`);
    assert.equal(expected.code, 0, expected.error);
    assert.equal(actual.code, 0, actual.error);
    assert.deepEqual(actual.output, expected.output);
  });
}
