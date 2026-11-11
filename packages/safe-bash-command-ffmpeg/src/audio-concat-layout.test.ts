import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const mono = Array.from({ length: 12 }, (_, i) => (i + 1) * 1000);
const stereo = mono.flatMap(sample => [sample, sample]);
// Complete PCM16 output from native FFmpeg 7.0.2.
const remixed = [707, 1414, 2121, 2828, 3535, 4243, 4950, 5657, 6364, 7071, 7778, 8485]
  .flatMap(sample => [sample, sample]);

for (const [name, graph, expected] of [
  ["mono second segment", "[0:a]pan=stereo|c0=c0|c1=c0[a];[a][0:a]concat=v=0:a=1[o]", [...stereo, ...remixed]],
  ["explicitly duplicated second segment", "[0:a]pan=stereo|c0=c0|c1=c0[a];[0:a]pan=stereo|c0=c0|c1=c0[b];[a][b]concat=v=0:a=1[o]", [...stereo, ...stereo]],
  ["matching mono segments", "[0:a][0:a]concat=v=0:a=1[o]", [...mono, ...mono]]
] as const) {
  it(`matches native concat channel gains: ${name}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from(mono, sample => sample / 32768)] }));
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-filter_complex", graph,
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
    const output = Buffer.concat(stdout);
    assert.equal(output.length, expected.length * 2);
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
  });
}
