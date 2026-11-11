import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = Array.from({ length: 16 }, (_, index) => (-1) ** index * (16001 + index * 231));

// Complete PCM16 output captured from FFmpeg 7.0.2, including branch-order controls.
for (const [first, second, overlap, transition] of [
  ["volume=1", "anull", 1, [14080, -13560, 13040, -12520]],
  ["aformat=sample_fmts=flt", "anull", 0, [14080, -9502, 4809, 0, 0, -4058, 8232, -12520]],
  ["aformat=sample_fmts=dbl", "anull", 1, [14080, -13560, 13040, -12520]],
  ["aformat=sample_fmts=fltp", "anull", 0, [14080, -9502, 4809, 0, 0, -4058, 8232, -12520]],
  ["aformat=sample_fmts=dblp", "anull", 1, [14080, -13560, 13040, -12520]],
  ["aformat=sample_fmts=s16p", "volume=1", 1, [14079, -13560, 13040, -12520]],
  ["anull", "volume=1", 1, [14079, -13560, 13040, -12520]],
  ["anull", "aformat=sample_fmts=flt", 0, [14079, -9502, 4808, 0, 0, -4058, 8231, -12520]]
] as const) {
  it(`acrossfade uses first-branch precision for ${first}/${second}, overlap=${overlap}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from(input, value => value / 32768)] }));
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-filter_complex",
        `[0:a]asplit=2[x][y];[x]${first}[a];[y]${second}[b];[a][b]acrossfade=ns=4:o=${overlap}[o]`,
        "-map", "[o]", "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    const bytes = Buffer.concat(stdout);
    assert.deepEqual(Array.from({ length: bytes.length / 2 }, (_, index) => bytes.readInt16LE(index * 2)),
      [...input.slice(0, 12), ...transition, ...input.slice(4)]);
  });
}
