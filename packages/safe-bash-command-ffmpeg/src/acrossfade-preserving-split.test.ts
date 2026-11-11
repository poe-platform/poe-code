import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = Array.from({ length: 16 }, (_, i) => (-1) ** i * (16001 + i * 231));
const prefix = input.slice(0, 12);
// Reported PCM16 outputs from FFmpeg 7.0.2; conversion control also checked on 9.0.1.
for (const [left, right, overlap, expected] of [
  ["asetpts=PTS", "anull", 1, prefix],
  ["anull", "asetpts=PTS", 0, prefix],
  ["afade=t=out:ss=100", "anull", 1, prefix],
  ["aformat=sample_fmts=s16", "anull", 1, prefix],
  ["anull", "anull", 1, prefix],
  ["anull", "aformat=sample_fmts=flt", 1, [...prefix, 14079, -13560, 13040, -12520, ...input.slice(4)]],
  ["anull", "volume=1", 1, [...prefix, 14079, -13560, 13040, -12520, ...input.slice(4)]]
] as const) {
  it(`preserves split EOF through ${left} / ${right}, overlap=${overlap}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from(input, sample => sample / 32768)] }));
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-filter_complex",
        `[0:a]asplit=2[x][y];[x]${left}[a];[y]${right}[b];[a][b]acrossfade=ns=4:o=${overlap}[o]`,
        "-map", "[o]", "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    const output = Buffer.concat(chunks);
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
  });
}
