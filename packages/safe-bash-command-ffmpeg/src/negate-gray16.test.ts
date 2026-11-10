import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = "102030405060708090a0b0c0d0e0f001";
const inverted = "efdfcfbfaf9f8f7f6f5f4f3f2f1f0ffe";

// Native FFmpeg 7.0.2, four gray16be 2x1 frames at 2 fps.
for (const [filter, expected, source = input] of [
  ["null", input],
  ["negate=components=none", input],
  ["negate=components=0", input],
  ["negate", inverted],
  ["negate=components=y", inverted],
  ["negate,negate", input],
  ["negate=enable=0", input],
  ["negate=enable=gte(n\\,2)", input.slice(0, 16) + inverted.slice(16)],
  ["sendcmd=c='0.5 negate@x components y;1 negate@x components none',negate@x=components=none",
    input.slice(0, 8) + inverted.slice(8, 16) + input.slice(16)],
  ["negate", "fffffffeff0080007fff00ff00010000", "0000000100ff7fff8000ff00fffeffff"]
] as const) {
  for (const graph of [false, true]) {
    it(`preserves full gray16be precision with ${filter} (${graph ? "graph" : "simple"}, ${source})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from(source, "hex") });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray16be", "-video_size", "2x1", "-framerate", "2",
          "-i", "/in.raw", ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
          "-pix_fmt", "gray16be", "-f", "rawvideo", "/out.raw"],
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
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    });
  }
}
