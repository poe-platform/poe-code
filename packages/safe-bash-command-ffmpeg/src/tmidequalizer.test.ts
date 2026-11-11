import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from([36, 40, 44, 192, 44, 40, 36, 32, 30].flatMap(v => [v, v + 4, v + 8, v + 12]));
// Complete native FFmpeg 7.0.2 outputs, including both boundary frames.
for (const [filter, hex] of [
  ["tmidequalizer=radius=1", "24282c30282c30343b3f4347a0a4a8ac3b3f4347282c303424282c302024282c1e22262a"],
  ["tmidequalizer=radius=2:sigma=1", "262a2e323f43474b4a4e52565054585c4044484c484c505425292d3122262a2e2024282c"],
  ["tmidequalizer=radius=2:planes=0", input.toString("hex")],
  ["tmidequalizer=radius=2:planes=2", input.toString("hex")],
  ["tmidequalizer=radius=2:sigma=0", input.toString("hex")],
  ["null", input.toString("hex")]
] as const) {
  for (const graph of [false, true]) {
    it(`${filter} preserves all bytes and timestamps (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input });
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const chain = `${filter},showinfo`;
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "rawvideo", "-pixel_format", "gray",
          "-video_size", "2x2", "-framerate", "4", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:v]${chain}[v]`, "-map", "[v]"] : ["-vf", chain]),
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(data: Uint8Array) { chunks.push(data); } },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(chunks).toString("hex"), hex);
      const lines = stderr.split("\n").filter(line => line.includes("pts_time:"));
      assert.equal(lines.length, 9, stderr);
      for (let i = 0; i < 9; i++) {
        assert.equal(Number(lines[i]!.split("pts:")[1]!.trim().split(" ")[0]), i);
        assert.equal(Number(lines[i]!.split("pts_time:")[1]!.trim().split(" ")[0]), i / 4);
      }
    });
  }
}

for (const option of ["radius=0", "radius=128", "sigma=-0.1", "sigma=1.1", "planes=16", "missing=1"]) {
  it(`rejects ${option} without overwriting output`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x2",
        "-framerate", "4", "-i", "/in.raw", "-vf", `tmidequalizer=${option}`, "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.notEqual(result.exitCode, 0, stderr);
    assert.ok(stderr.includes("tmidequalizer:"), stderr);
    assert.equal(volume.readFileSync("/out.raw").toString(), "KEEP");
  });
}
