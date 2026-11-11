import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const left = [10, 20, 30, 40, 50];
const right = [100, 200, 300, 400, 500];

// PCM16 references from FFmpeg 7.0.2. The first mix input retains its speaker label.
for (const [graph, expected] of [
  ["[L][R]amix=normalize=0[out]", [110, 220, 330, 440, 550]],
  ["[L][R]amix=normalize=0:weights=1 2[out]", [210, 420, 630, 840, 1050]],
  ["[L][R]amix[out]", [55, 110, 165, 220, 275]],
  ["[L][R]amix=weights=1 2[out]", [70, 140, 210, 280, 350]],
  ["[R][L]amix=normalize=0:weights=1 2[out]", [120, 240, 360, 480, 600]],
  ["[L][R]amix=normalize=0,pan=mono|c0=FL[out]", [110, 220, 330, 440, 550]],
  ["[R][L]amix=normalize=0,pan=mono|c0=FR[out]", [110, 220, 330, 440, 550]],
  ["[L][R]join[out]", [10, 100, 20, 200, 30, 300, 40, 400, 50, 500]]
] as const) {
  it(`mixes split stereo channels: ${graph}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/s.wav", encodeWav({ sampleRate: 8000,
      channels: [left, right].map(samples => Float64Array.from(samples, sample => sample / 32768)) }));
    const output: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/s.wav", "-filter_complex", `[0:a]channelsplit[L][R];${graph}`,
        "-map", "[out]", "-bitexact", "-f", "s16le", "pipe:1"],
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
    const pcm = Buffer.concat(output);
    assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, index) => pcm.readInt16LE(index * 2)), expected);
  });
}
