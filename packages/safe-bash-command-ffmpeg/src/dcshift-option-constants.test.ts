import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: five mono PCM32 samples at 8 kHz, output as s32le.
const input = Buffer.from("00000080000000c00000000000000070ffffff7f", "hex");
for (const [shift, exitCode, expected] of [
  ["max", 0, "0000000000000040ffffff7fffffff7fffffff7f"],
  ["min", 0, "000000800000008000000080000000f0ffffffff"],
  ["all", 0, "000000800000008000000080000000f0ffffffff"],
  ["default", 0, input.toString("hex")],
  ["none", 0, input.toString("hex")],
  ["1", 0, "0000000000000040ffffff7fffffff7fffffff7f"],
  ["-1", 0, "000000800000008000000080000000f0ffffffff"],
  ["0", 0, input.toString("hex")],
  ["2", 222, ""],
  ["bad", 234, ""]
] as const) for (const named of [false, true]) for (const graph of [false, true]) {
  const filter = `dcshift=${named ? "shift=" : ""}${shift}`;
  it(`matches native ${filter} PCM bytes and exit status (${graph ? "graph" : "simple"})`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": input });
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
