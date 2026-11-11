import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [256, 512, 768, 1024, -256, -512, -768, -1024];
// Native FFmpeg 7.0.2: fixed gain rounds at the format selected by aformat.
for (const [format, gain, expected] of [
  ["u8", "1.5:precision=fixed", [512, 768, 1280, 1536, -256, -768, -1024, -1536]],
  ["u8p", "1.5:precision=fixed", [512, 768, 1280, 1536, -256, -768, -1024, -1536]],
  ["s16", "1.5:precision=fixed", [384, 768, 1152, 1536, -384, -768, -1152, -1536]],
  ["s16p", "1.5:precision=fixed", [384, 768, 1152, 1536, -384, -768, -1152, -1536]],
  ["u8", "1:precision=fixed", samples],
  ["u8", "1.5:precision=fixed:enable=0", samples],
  ["u8", "1.5:precision=float", [384, 768, 1152, 1536, -384, -768, -1152, -1536]]
] as const) for (const graph of [false, true]) {
  it(`applies volume=${gain} after PCM16 becomes ${format} (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({});
    const input = encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples, value => value / 32768)] });
    fs.writeFileSync("/in.wav", input);
    const filter = `aformat=sample_fmts=${format},volume=${gain}`;
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.deepEqual(fs.readFileSync("/in.wav"), Buffer.from(input));
    const output = fs.readFileSync("/out.raw") as Buffer;
    assert.equal(output.length, expected.length * 2);
    assert.deepEqual(Array.from({ length: expected.length }, (_, index) => output.readInt16LE(index * 2)), expected);
  });
}
