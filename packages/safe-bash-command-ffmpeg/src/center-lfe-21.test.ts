import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [1000, 9000, 2000, -6000, -3000, 3000];
// Complete PCM16 output from native FFmpeg 7.0.2.
const surround = [707, 707, 9000, 1414, 1414, -6000, -2121, -2121, 3000];
for (const [filter, options, expected] of [
  ["", ["-ac", "3"], surround],
  ["", ["-ch_layout", "2.1"], surround],
  ["aformat=channel_layouts=2.1", [], surround],
  ["aresample=ochl=2.1", [], surround],
  ["", ["-ac", "2"], [707, 707, 1414, 1414, -2121, -2121]],
  ["", [], samples]
] as const) for (const graph of [false, true]) {
  it(`routes center and LFE to 2.1: ${filter} ${options.join(" ")} (graph=${graph})`, async () => {
    const input = Buffer.alloc(44 + samples.length * 2);
    input.write("RIFF"); input.writeUInt32LE(input.length - 8, 4);
    input.write("WAVEfmt ", 8); input.writeUInt32LE(16, 16);
    input.writeUInt16LE(1, 20); input.writeUInt16LE(2, 22);
    input.writeUInt32LE(8000, 24); input.writeUInt32LE(32000, 28);
    input.writeUInt16LE(4, 32); input.writeUInt16LE(16, 34);
    input.write("data", 36); input.writeUInt32LE(samples.length * 2, 40);
    samples.forEach((sample, index) => input.writeInt16LE(sample, 44 + index * 2));
    const volume = Volume.fromJSON({ "/in.wav": input });
    const stdout: Buffer[] = [];
    let stderr = "";
    const chain = "channelmap=map=0|1:channel_layout=FC+LFE" + (filter ? `,${filter}` : "");
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${chain}[a]`, "-map", "[a]"] : ["-af", chain]),
        ...options, "-f", "s16le", "pipe:1"],
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
    const output = Buffer.concat(stdout);
    assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
    assert.deepEqual(volume.readFileSync("/in.wav"), input);
  });
}
