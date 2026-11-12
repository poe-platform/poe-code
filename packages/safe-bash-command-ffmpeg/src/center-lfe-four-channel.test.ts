import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Interleaved PCM16 outputs from native FFmpeg 7.0.2; -ac 4 selects FL FR FC BC.
for (const [layout, channels, gain, expected] of [
  ["FC+LFE", "4", undefined, [0, 0, 101, 0, 0, 0, 202, 0, 0, 0, 303, 0, 0, 0, 404, 0]],
  ["FC+LFE", "4", "2", [0, 0, 202, 0, 0, 0, 404, 0, 0, 0, 606, 0, 0, 0, 808, 0]],
  ["stereo", "4", undefined, [101, -901, 0, 0, 202, -802, 0, 0, 303, -703, 0, 0, 404, -604, 0, 0]],
  ["FC+LFE", "1", undefined, [101, 202, 303, 404]]
] as const) {
  it(`routes ${layout} to ${channels} channels with rematrix gain ${gain ?? "default"}`, async () => {
    const input = Buffer.alloc(16);
    [101, -901, 202, -802, 303, -703, 404, -604].forEach((sample, index) => input.writeInt16LE(sample, index * 2));
    const volume = Volume.fromJSON({ "/in.raw": input });
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ch_layout", layout, "-i", "/in.raw",
        "-ac", channels, ...(gain === undefined ? [] : ["-rematrix_volume", gain]), "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const bytes = Buffer.concat(stdout);
    assert.deepEqual(Array.from({ length: bytes.length / 2 }, (_, index) => bytes.readInt16LE(index * 2)), expected);
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
