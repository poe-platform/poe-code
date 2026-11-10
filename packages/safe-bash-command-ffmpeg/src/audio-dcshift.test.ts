import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [-32768, -30000, -123, -2, -1, 0, 1, 2, 123, 30000, 32767, 10000];
// FFmpeg 7.0.2: -f s16le -ar 8000 -ac 1 -i in.raw -af dcshift=SHIFT -f s16le out.raw.
for (const [shift, expected] of [
  ["0.1", [-29492, -26724, 3153, 3274, 3275, 3276, 3277, 3278, 3399, 32767, 32767, 13276]],
  ["0.0000152587890625", samples],
  ["-0.0000152587890625", [-32768, -30001, -124, -3, -2, -1, 0, 1, 122, 29999, 32766, 9999]],
  ["0.25", [-24576, -21808, 8069, 8190, 8191, 8192, 8193, 8194, 8315, 32767, 32767, 18192]],
  ["-0.1", [-32768, -32768, -3400, -3279, -3278, -3277, -3276, -3275, -3154, 26723, 29490, 6723]]
] as const) for (const graph of [false, true]) {
  it(`matches native dcshift=${shift} PCM bytes (${graph ? "graph" : "simple"})`, async () => {
    const input = Buffer.alloc(samples.length * 2);
    samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
    const output = Buffer.alloc(expected.length * 2);
    expected.forEach((sample, i) => output.writeInt16LE(sample, i * 2));
    const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
    const filter = `dcshift=${shift}`;
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
        "-f", "s16le", "/out.raw"],
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
    assert.deepEqual(volume.readFileSync("/out.raw"), output);
  });
}
