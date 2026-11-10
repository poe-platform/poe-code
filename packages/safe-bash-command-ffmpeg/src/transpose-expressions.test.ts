import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Two 4x2 RGBA frames, with exact output bytes from native FFmpeg 7.0.2.
const input = Buffer.from(Array.from({ length: 64 }, (_, index) => (index * 29 + 17) % 256));
const counterclockwise = "6d8aa7c43d5a7794f9163350c9e6032085a2bfdc55728fac112e4b68e1fe1b380d2a4764ddfa173499b6d3f06986a3c025425f7cf5122f4cb1ceeb08819ebbd8";
const flippedClockwise = "3d5a77946d8aa7c4c9e60320f916335055728fac85a2bfdce1fe1b38112e4b68ddfa17340d2a47646986a3c099b6d3f0f5122f4c25425f7c819ebbd8b1ceeb08";

for (const [options, exitCode, expected] of [
  ["unknown=1", 8, "4b454550"],
  ["enable=0", 176, "4b454550"],
  ["enable=1", 176, "4b454550"],
  ["dir=-1", 222, "4b454550"],
  ["dir=8", 222, "4b454550"],
  ["dir=0.5", 0, "112e4b68e1fe1b3885a2bfdc55728facf9163350c9e603206d8aa7c43d5a7794b1ceeb08819ebbd825425f7cf5122f4c99b6d3f06986a3c00d2a4764ddfa1734"],
  ["dir=1.5", 0, counterclockwise],
  ["dir=2.5", 0, counterclockwise],
  ["dir=PI", 0, flippedClockwise],
  ["dir=E", 0, flippedClockwise],
  ["dir=PHI", 0, counterclockwise],
  ["clock:passthrough=1+0", 0, input.toString("hex")],
  ["clock:passthrough=0b1", 234, "4b454550"],
  ["dir=0b1", 234, "4b454550"],
  ["dir=2", 0, counterclockwise],
  ["clock:landscape", 0, input.toString("hex")],
  ["clock:passthrough=0x1", 0, input.toString("hex")],
  ["cclock:passthrough=0.5", 0, counterclockwise],
  ["cclock:passthrough=1.5", 0, counterclockwise],
  ["cclock:passthrough=2.5", 0, counterclockwise],
  ["cclock:passthrough=landscape+0", 0, input.toString("hex")],
  ["cclock:passthrough=PHI", 0, counterclockwise]
] as const) {
  it(`transpose=${options} matches native status and output bytes`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "4x2",
        "-framerate", "2", "-i", "/in.raw", "-vf", `transpose=${options}`, "-pix_fmt", "rgba", "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode, stderr);
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
    if (exitCode !== 0) assert.ok(stderr.includes("transpose:"), stderr);
  });
}
