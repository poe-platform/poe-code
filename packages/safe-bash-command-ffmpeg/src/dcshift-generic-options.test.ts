import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Eight zero PCM32 samples at 8 kHz. Native FFmpeg adds 536870912 for shift=0.25.
for (const [options, status, sample] of [
  ["0.25", 0, 536870912],
  ["0.25:threads=1", 0, 536870912],
  ["0.25:thread_type=slice", 0, 536870912],
  ["0.25:extra_hw_frames=0", 0, 536870912],
  ["0.25:threads=1:thread_type=slice:extra_hw_frames=0", 0, 536870912],
  ["0.25:threads=0:thread_type=none:extra_hw_frames=-1", 0, 536870912],
  ["0.25:threads=2147483647:extra_hw_frames=2147483647", 0, 536870912],
  ["0.25:threads=default:extra_hw_frames=min", 0, 536870912],
  ["0.25:threads=1+1:thread_type=all-slice:extra_hw_frames=2-1", 0, 536870912],
  ["0.25:thread_type=4294967295", 0, 536870912],
  ["0.25:threads=1:threads=2", 0, 536870912],
  ["threads=1:shift=0.25:limitergain=0.1", 0, 536870911],
  ["0.125:threads=1:0.25", 0, 536870912],
  ["0.25: threads = 1 : extra_hw_frames = 0", 0, 536870912],
  ["0.25:threads=1:enable=0", 0, 0],
  ["threads=1:thread_type=slice:extra_hw_frames=0", 0, 0],
  ["0.25:threads=-1", 222, 0],
  ["0.25:threads=2147483648", 222, 0],
  ["0.25:threads=-1:threads=1", 222, 0],
  ["0.25:thread_type=0.5", 222, 0],
  ["0.25:thread_type=4294967296", 222, 0],
  ["0.25:extra_hw_frames=-2", 222, 0],
  ["0.25:extra_hw_frames=2147483648", 222, 0],
  ["0.25:extra_hw_frames=-2:extra_hw_frames=0", 222, 0],
  ["0.25:threads=", 234, 0],
  ["0.25:threads=bogus", 234, 0],
  ["0.25:thread_type=", 234, 0],
  ["0.25:thread_type=bogus", 234, 0],
  ["0.25:extra_hw_frames=", 234, 0],
  ["0.25:extra_hw_frames=bogus", 234, 0]
] as const) for (const graph of [false, true]) {
  it(`dcshift accepts bounded generic options: ${options} (${graph ? "graph" : "simple"})`, async () => {
    const input = Buffer.concat([
      Buffer.from("524946464400000057415645666d74201000000001000100401f0000007d0000040020006461746120000000", "hex"),
      Buffer.alloc(32)
    ]);
    const volume = Volume.fromJSON({ "/in.wav": input, "/out.raw": "KEEP" });
    const filter = `dcshift=${options}`;
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s32le", status === 0 ? "pipe:1" : "/out.raw"],
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
    assert.equal(result.exitCode, status, stderr);
    const expected = Buffer.alloc(status === 0 ? 32 : 0);
    for (let offset = 0; offset < expected.length; offset += 4) expected.writeInt32LE(sample, offset);
    assert.deepEqual(Buffer.concat(stdout), expected);
    assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
    assert.deepEqual(volume.readFileSync("/in.wav"), input);
  });
}
