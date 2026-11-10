import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const pcm = Buffer.from("0080803ec0e0e02ea00f401fe02ea00f803e60f0e02ec0e0401f20d1a00f80c1", "hex");
const input = Buffer.alloc(44 + pcm.length);
input.write("RIFF"); input.writeUInt32LE(input.length - 8, 4); input.write("WAVEfmt ", 8);
input.writeUInt32LE(16, 16); input.writeUInt16LE(1, 20); input.writeUInt16LE(2, 22);
input.writeUInt32LE(8000, 24); input.writeUInt32LE(32000, 28);
input.writeUInt16LE(4, 32); input.writeUInt16LE(16, 34);
input.write("data", 36); input.writeUInt32LE(pcm.length, 40); pcm.copy(input, 44);

// Complete native FFmpeg 7.0.2 outputs, including controls for the headroom boundary.
for (const [filter, format, expected] of [
  ["asubboost=feedback=0", "s16le", pcm.toString("hex")],
  ["asubboost=feedback=0", "f32le", "000080bf0000fa3e00007abe0080bb3e0000fa3d00007a3e0080bb3e0000fa3d0000fa3e0000fabd0080bb3e00007abe00007a3e0080bbbe0000fa3d0000fabe"],
  ["anull", "s16le", pcm.toString("hex")],
  ["atrim=start_sample=1,asubboost=feedback=0", "s16le", pcm.subarray(4).toString("hex")],
  ["asubboost=feedback=0:dry=0.5", "s16le", "00c0401f60f07017d007a00f7017d007401f30f8701760f0a00f90e8d007c0e0"]
] as const) for (const graph of [false, true]) {
  it(`${filter} preserves full-scale stereo audio as ${format} (graph=${graph})`, async () => {
    const volume = Volume.fromJSON({ "/in.wav": input, "/out": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
        ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", format, "/out"],
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
    assert.equal((volume.readFileSync("/out") as Buffer).toString("hex"), expected);
  });
}
