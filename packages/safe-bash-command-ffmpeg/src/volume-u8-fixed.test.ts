import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg results, observed through float output before encoder rounding.
for (const [format, input, filter, expected] of [
  ["u8", [0, 1, 64, 125, 127, 128, 129, 191, 255], "0.5:precision=fixed",
    [-64, -63, -32, -1, 0, 0, 1, 32, 64].map(value => value / 128)],
  ["u8", [0, 1, 64, 125, 127, 128, 129, 191, 255], "2:precision=fixed",
    [-128, -128, -128, -6, -2, 0, 2, 126, 127].map(value => value / 128)],
  ["u8", [0, 1, 64, 125, 127, 128, 129, 191, 255], "1:precision=fixed",
    [-128, -127, -64, -3, -1, 0, 1, 63, 127].map(value => value / 128)],
  ["u8", [0, 1, 64, 125, 127, 128, 129, 191, 255], "0.5:precision=float",
    [-128, -127, -64, -3, -1, 0, 1, 63, 127].map(value => value / 256)],
  ["s16le", [-32768, -30001, -5, -3, -1, 0, 1, 3, 5, 30001, 32767], "0.5:precision=fixed",
    [-16384, -15000, -2, -1, 0, 0, 1, 2, 3, 15001, 16384].map(value => value / 32768)],
  ["s16le", [-32768, -30001, -5, -3, -1, 0, 1, 3, 5, 30001, 32767], "2:precision=fixed",
    [-32768, -32768, -10, -6, -2, 0, 2, 6, 10, 32767, 32767].map(value => value / 32768)]
] as const) {
  it(`preserves ${format} sample depth for volume=${filter}`, async () => {
    const fs = Volume.fromJSON({ "/out.raw": "keep" });
    const bytes = Buffer.alloc(input.length * (format === "u8" ? 1 : 2));
    input.forEach((value, index) => {
      if (format === "u8") bytes[index] = value;
      else bytes.writeInt16LE(value, index * 2);
    });
    fs.writeFileSync("/in.raw", bytes);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", format, "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        "-af", `volume=${filter}`, "-c:a", "pcm_f32le", "-f", "f32le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
      stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const output = fs.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, expected.length * 4);
    assert.deepEqual(Array.from({ length: expected.length }, (_, index) => output.readFloatLE(index * 4)), expected);
  });
}
