import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: mono PCM32 at 8 kHz, samples [-2147483648, -1073741824, 0, 1879048192, 2147483647].
for (const [options, exitCode, expected] of [
  ["shift=0.5:limitergain=0.25:0.75", 0, "000000e0ffffff1fffffff5f0000004000000040"],
  ["limitergain=0.25:shift=0.5:0.75", 0, "000000e0ffffff1fffffff5f0000004000000040"],
  ["0.5:limitergain=0.25:0.75", 0, "000000e0ffffff1fffffff5f0000004000000040"],
  ["0.75:0.25", 0, "000000e0ffffff1fffffff5f0000004000000040"],
  ["shift=0.5:0.25", 0, "000000c000000000ffffff3fffffff5f00000060"],
  ["0.5:0.25", 0, "000000c000000000ffffff3fffffff5f00000060"],
  ["0.5:0.75", 0, "000000c000000000ffffff3fffffff7fffffff7f"],
  ["shift=0.5:limitergain=0.25:0.75:0.125", 0, "000000e0ffffff1fffffff5f0000003000000030"],
  ["shift=0.5:limitergain=0.25:shift=0.75:0.125", 0, "000000e0ffffff1fffffff5f0000003000000030"],
  ["0.5:0.25:0.75", 234, ""]
] as const) for (const graph of [false, true]) {
  it(`matches native dcshift=${options} status and PCM32 bytes (${graph ? "graph" : "simple"})`, async () => {
    const input = Buffer.alloc(20);
    [-2147483648, -1073741824, 0, 1879048192, 2147483647].forEach((sample, i) => input.writeInt32LE(sample, i * 4));
    const volume = Volume.fromJSON({ "/in.raw": input });
    const filter = `dcshift=${options}`;
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s32le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
        "-f", "s32le", "pipe:1"],
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
    assert.equal(result.exitCode, exitCode, stderr);
    assert.deepEqual(Buffer.concat(stdout), Buffer.from(expected, "hex"));
  });
}
