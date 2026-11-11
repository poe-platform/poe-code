import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: signed PCM32 mono at 8 kHz, dcshift=shift=0.5:limitergain=GAIN.
const samples = [-2147483648, -1073741824, 0, 1879048192, 2147483647];
const quarter = "000000c000000000ffffff3fffffff5f00000060";
const pi = "000000c000000000ffffff3fed5e3668ed5e3668";
const zero = "000000c00000000000000040ffffff7fffffff7f";
const one = "000000c000000000ffffff3fffffff7fffffff7f";
for (const [gain, exitCode, hex] of [
  ["1/4", 0, quarter],
  ["0.25", 0, quarter],
  ["PI/10", 0, pi],
  ["0.3141592653589793", 0, pi],
  ["default", 0, zero],
  ["0", 0, zero],
  ["min", 0, zero],
  ["max", 0, one],
  ["none", 0, zero],
  ["all", 222, ""],
  ["0x1", 0, one],
  ["0b1", 234, ""],
  ["0o1", 234, ""],
  ["2", 222, ""],
  ["bad", 234, ""],
  ["", 234, ""],
  ["-0.1", 222, ""],
  ["1.1", 222, ""],
  ["NaN", 234, ""]
] as const) for (const graph of [false, true]) for (const destination of ["pipe:1", "/out.raw"]) {
  it(`matches native limitergain=${gain} status and PCM (${graph ? "graph" : "simple"}, ${destination})`, async () => {
    const input = Buffer.alloc(samples.length * 4);
    samples.forEach((sample, index) => input.writeInt32LE(sample, index * 4));
    const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
    const filter = `dcshift=shift=0.5:limitergain=${gain}`;
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "s32le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
        "-f", "s32le", destination],
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
    assert.deepEqual(Buffer.concat(stdout), Buffer.from(destination === "pipe:1" ? hex : "", "hex"));
    assert.deepEqual(volume.readFileSync("/out.raw"), destination === "/out.raw" && exitCode === 0
      ? Buffer.from(hex, "hex") : Buffer.from("KEEP"));
  });
}
