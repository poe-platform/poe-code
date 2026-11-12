import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 references for 64 stereo PCM16 frames at 8000 Hz.
const samples = [30000, 300, 22000, -400, -17000, 500, 16000, -600, 1000, 700, -1800, 600, 2000, -900, 2000, 700];
for (const [options, hash] of [
  ["threshold=0.25:attack=5:0.5", "40b8b6c1f1808e6a4e6d9c1cdde7e6082c28d78d696fb4abcf35de2d9bf6cf3f"],
  ["threshold=0.25:attack=5:level_in=0.5", "40b8b6c1f1808e6a4e6d9c1cdde7e6082c28d78d696fb4abcf35de2d9bf6cf3f"],
  ["threshold=0.25:attack=5:threshold=0.5", "5e9159e651f26e37b1d1a32f8fc25b2143e68a11d137c236c35ae841aefb7c5d"],
  ["threshold=0.25:attack=5:0.5:upward", "e71943e924bca04bb37e622fa42fbcaea7d9a4afe60a5014bd4d41bdc13cb8ef"],
  ["threshold=0.25:attack=5:level_in=0.5:mode=upward", "e71943e924bca04bb37e622fa42fbcaea7d9a4afe60a5014bd4d41bdc13cb8ef"],
  ["threshold=0.25:upward", "5020027db121c4b00372617361a5c53dcfea65b24c26fb3d1ab10e7a5f891aff"],
  ["threshold=0.25:mode=upward", "5020027db121c4b00372617361a5c53dcfea65b24c26fb3d1ab10e7a5f891aff"]
] as const) for (const graph of [false, true]) {
  it(`acompressor=${options} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
    const input = Buffer.alloc(256);
    for (let i = 0; i < 128; i++) input.writeInt16LE(samples[i % samples.length]!, i * 2);
    const volume = Volume.fromJSON({ "/in.raw": input });
    const filter = `acompressor=${options}`;
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "/out.pcm"],
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
    const output = volume.readFileSync("/out.pcm") as Buffer;
    assert.equal(output.length, 256);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
