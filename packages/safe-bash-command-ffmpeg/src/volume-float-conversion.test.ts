import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 hashes for 6400 stereo PCM16 frames at 8000 Hz.
for (const [filter, format, expected] of [
  ["agate,volume=1.25", "f32le", "5472bd2c2fe16250f4c030304a1615d9676c74327582c02cdf86e874ffc85a46"],
  ["agate,volume=1.25:precision=float", "f32le", "5472bd2c2fe16250f4c030304a1615d9676c74327582c02cdf86e874ffc85a46"],
  ["agate,volume=1.25", "s32le", "a3250e645d764f5d239b6840d4206ca0427d4feba91e543b3150d2bb9bc521ca"],
  ["agate,aformat=sample_fmts=flt,volume=1.25", "f32le", "5472bd2c2fe16250f4c030304a1615d9676c74327582c02cdf86e874ffc85a46"],
  ["agate,volume=1.25:precision=double", "f32le", "f45465a47edecce5082c5b97290704607a23b61e1ac48f2df992db1ffea401ed"],
  ["agate", "f32le", "bdd4fe6a35df12a35fce2c8c8dde45ade34160a8474b899feebbc3ea9d4f845e"],
  ["volume=1.25", "f32le", "b7b22819379bb498528c2027c83909c87b98c54afa45c9a453e92920e46f02c8"]
] as const) for (const graph of [false, true]) {
  it(`matches native ${format} for ${filter} (${graph ? "graph" : "simple"})`, async () => {
    const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
    const input = encodeWav({
      sampleRate: 8000,
      channels: [
        Float64Array.from({ length: 6400 }, (_, i) => ((i * 131) % 4001 - 2000) * [1, 6, 2, 0][Math.floor(i / 512) % 4]! / 32768),
        Float64Array.from({ length: 6400 }, (_, i) => ((i * 47) % 1801 - 900) * [2, 1, 16, 0][Math.floor(i / 512) % 4]! / 32768)
      ]
    });
    fs.writeFileSync("/in.wav", input);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", format, "/out.raw"],
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
    assert.equal(output.length, 51200);
    assert.equal(createHash("sha256").update(output).digest("hex"), expected);
  });
}
