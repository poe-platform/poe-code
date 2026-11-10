import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 float-transfer boundaries and unfiltered control.
const inputSamples = [-32670, -31718, -32677, -30955, 30955, 32677, 31718, 32670];
for (const [filter, format, expected] of [
  ["acontrast", "s16le", [-32768, -32711, -32768, -32598, 32598, 32767, 32711, 32767]],
  ["acontrast=0", "s16le", [-32768, -32726, -32768, -32644, 32644, 32767, 32726, 32767]],
  ["acontrast=100", "s16le", [-32767, -32671, -32767, -32482, 32482, 32767, 32671, 32767]],
  ["anull", "s16le", inputSamples],
  ["acontrast", "f32le", [-0.9999847412109375, -0.9982521533966064, -0.9999868273735046, -0.9948127269744873, 0.9948127269744873, 0.9999868273735046, 0.9982521533966064, 0.9999847412109375]],
  ["acontrast=0", "f32le", [-0.9999889731407166, -0.9987335205078125, -0.9999904632568359, -0.9962257146835327, 0.9962257146835327, 0.9999904632568359, 0.9987335205078125, 0.9999889731407166]]
] as const) for (const graph of [false, true]) {
  it(`${filter} matches native ${format} bytes at rounding boundaries (${graph ? "graph" : "simple"})`, async () => {
    const input = Buffer.alloc(inputSamples.length * 2);
    inputSamples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
    const output = Buffer.alloc(expected.length * (format === "s16le" ? 2 : 4));
    expected.forEach((sample, i) => format === "s16le"
      ? output.writeInt16LE(sample, i * 2) : output.writeFloatLE(sample, i * 4));
    const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
        "-f", format, "/out.raw"],
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
    assert.deepEqual(volume.readFileSync("/out.raw"), output);
  });
}
