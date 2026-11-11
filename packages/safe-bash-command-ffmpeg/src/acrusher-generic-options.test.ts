import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: f64le samples [-0.75, 0.25] at 8 kHz, output as s16le.
for (const [option, exitCode] of [
  ["", 0], ["threads=1", 0], ["thread_type=slice", 0], ["extra_hw_frames=1", 0],
  ["threads=1:thread_type=slice:extra_hw_frames=1", 0],
  ["threads=0:thread_type=none:extra_hw_frames=-1", 0],
  ["threads=default:extra_hw_frames=min", 0],
  ["threads=max:thread_type=4294967295:extra_hw_frames=max", 0],
  ["threads=1+1:thread_type=+slice-slice:extra_hw_frames=min+1", 0],
  ["threads=1.5:extra_hw_frames=0.5", 0],
  ["1:1:8:0.5:lin:1:0.5:1:0:20:0.3:threads=1", 0],
  ["bits=8:threads=1:mix=0.5:extra_hw_frames=1:", 0],
  ["threads=-1", 222], ["threads=2147483648", 222],
  ["threads=bogus", 234], ["threads=", 234],
  ["thread_type=bogus", 234], ["thread_type=0.5", 222],
  ["thread_type=4294967296", 222], ["thread_type=slice+", 234],
  ["extra_hw_frames=-2", 222], ["extra_hw_frames=2147483648", 222],
  ["extra_hw_frames=", 234], ["threads=-1:threads=1", 222],
  ["bogus=1", 8], ["threads=1:bogus=1", 8]
] as const) for (const graph of [false, true]) {
  it(`acrusher generic options ${option || "control"} (${graph ? "graph" : "simple"})`, async () => {
    const input = Buffer.alloc(16);
    input.writeDoubleLE(-0.75, 0);
    input.writeDoubleLE(0.25, 8);
    const volume = Volume.fromJSON({ "/in.raw": input });
    const filter = `acrusher${option ? `=${option}` : ""}`;
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "f64le", "-ac", "1", "-ar", "8000", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
        "-f", "s16le", "pipe:1"],
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
    assert.equal(Buffer.concat(stdout).toString("hex"), exitCode === 0 ? "10a01020" : "");
    if (exitCode === 0) assert.equal(stderr, "");
    else assert.ok(stderr.includes("acrusher:"), stderr);
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
