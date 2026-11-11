import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [-30000, -16385, -3, -1, 1, 3, 16385, 30000];
// Native FFmpeg 7.0.2 raw PCM output, including explicit intermediate controls.
for (const [format, intermediate, expected] of [
  ["u8", "", "0d3f80808080c1f3"],
  ["s32le", "", "0000d08a0000ffbffefffcff0100ffffffff0000020003000000014000003075"],
  ["s16le", "", "d08affbffbff00000000050001403075"],
  ["u8", "u8", "0d3f80808080c1f3"],
  ["s32le", "s32", "0000d08a0000ffbffefffcff0100ffffffff0000020003000000014000003075"],
  ["u8", "s16", "0a3f7f808080c0f5"]
] as const) for (const graph of [false, true]) {
  it(`negotiates fixed volume output ${format} after double (${intermediate || "automatic"}, ${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples, value => value / 32768)] }));
    const filter = `volume=.2:precision=double,${intermediate ? `aformat=sample_fmts=${intermediate},` : ""}volume=5:precision=fixed`;
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", format, "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return fs.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
        async stat(path: string) { return fs.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(Buffer.concat(errors).toString(), "");
    assert.equal(Buffer.concat(output).toString("hex"), expected);
  });
}
