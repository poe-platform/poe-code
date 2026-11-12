import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function render(channels: number, map: string, type = "time", responseChannels = 2) {
  const volume = Volume.fromJSON({});
  const program = Array.from({ length: 12 }, (_, i) => [5000 + i * 71, -1000 + i * 53]);
  const impulse = [[16384, 0], [0, 8192], [4096, 4096]];
  volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
    channels: Array.from({ length: channels }, (_, channel) =>
      Float64Array.from(program, frame => frame[channel]! / 32768)) }));
  volume.writeFileSync("/ir.wav", encodeWav({ sampleRate: 8000,
    channels: Array.from({ length: responseChannels }, (_, channel) =>
      Float64Array.from(impulse, frame => frame[channel]! / 32768)) }));
  const responses = map.split("|");
  const output: Uint8Array[] = [];
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", ...responses.flatMap(() => ["-i", "/ir.wav"]),
      "-filter_complex", `[0:a]${responses.map((_, index) => `[${index + 1}:a]`).join("")}headphone=map=${map}:type=${type}[o]`,
      "-map", "[o]", "-f", "s16le", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { result, output: Buffer.concat(output), error: Buffer.concat(errors).toString() };
}

// Native FFmpeg 7.0.2, signed 16-bit WAV inputs at 8000 Hz.
for (const type of ["time", "freq"]) {
  it(`headphone ${type} renders a mono center source with one stereo response`, async () => {
    const { result, output, error } = await render(1, "FC", type);
    assert.equal(result.exitCode, 0, error);
    assert.equal(error, "");
    assert.equal(output.toString("hex"),
      "ea06000003077503d7083c05f6084f0515096205350975055409870574099a059309ad05b309c005d209d305f109e605");
  });

  it(`headphone ${type} preserves the stereo program control`, async () => {
    const { result, output, error } = await render(2, "FL|FR", type);
    assert.equal(result.exitCode, 0, error);
    assert.equal(output.toString("hex"),
      "ea0300000904f5012305ff024a05170371052e0398054503be055d03e50574030c068b033306a2035a06ba038106d103");
  });
}

for (const [channels, map, responseChannels] of [[1, "FL|FR", 2], [2, "FC", 2]] as const) {
  it(`headphone rejects ${channels} source channels, map=${map}, ${responseChannels} response channels`, async () => {
    const { result, output } = await render(channels, map, "time", responseChannels);
    assert.notEqual(result.exitCode, 0);
    assert.equal(output.length, 0);
  });
}
