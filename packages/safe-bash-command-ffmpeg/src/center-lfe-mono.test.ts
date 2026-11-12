import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete PCM16 outputs from native FFmpeg 7.0.2.
for (const [layout, filter, expected] of [
  ["FC+LFE", "aformat=channel_layouts=mono", [1000, 2000, -3000]],
  ["FC+LFE", "aresample=ochl=mono", [1000, 2000, -3000]],
  ["FC+LFE", "", [1000, 2000, -3000]],
  ["stereo", "aformat=channel_layouts=mono", [5000, -2000, 0]],
  ["stereo", "aresample=ochl=mono", [5000, -2000, 0]]
] as const) {
  it(`converts ${layout} to mono using ${filter || "-ac 1"}`, async () => {
    const input = encodeWav({ sampleRate: 8000, channels: [
      Float64Array.from([1000, 2000, -3000], sample => sample / 32768),
      Float64Array.from([9000, -6000, 3000], sample => sample / 32768)
    ] });
    const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
    const output: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-af",
        `channelmap=map=0|1:channel_layout=${layout}${filter ? `,${filter}` : ""}`,
        ...filter ? [] : ["-ac", "1"], "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const bytes = Buffer.concat(output);
    assert.equal(bytes.length, expected.length * 2);
    assert.deepEqual(expected.map((_, index) => bytes.readInt16LE(index * 2)), expected);
    assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
  });
}
