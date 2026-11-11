import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 bytes for a 4x4 YUV420 frame, including chroma alignment.
for (const [filter, expected] of [
  ["crop=3:3:ow-1:oh-1", "535a6f7692ae"],
  ["crop=3:3:out_w-1:out_h-1", "535a6f7692ae"],
  ["crop=3:3:ow-1:0", "1b22373e84a0"],
  ["crop=3:3:0:oh-1", "454c61688ba7"],
  ["crop=2.4:2.4:ow*2-3:oh*2-3:exact=1", "535a6f7692ae"],
  ["crop=2.4:2.4:out_w*2-3:out_h*2-3:exact=1", "535a6f7692ae"],
  ["crop=2:2:2:2", "535a6f7692ae"],
  ["crop=2:2:0:0", "0d1429307d99"],
  ["sendcmd=c='0 crop out_w 3;0 crop out_h 3',crop=2:2:ow-1:oh-1", "535a6f7692ae"]
] as const) for (const graph of [false, true]) {
  it(`preserves requested crop dimensions: ${filter} (${graph ? "graph" : "simple"})`, async () => {
    const input = Buffer.from(Array.from({ length: 24 }, (_, i) => (13 + 7 * i) % 256));
    const volume = Volume.fromJSON({ "/in.raw": input });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", "4x4", "-i", "/in.raw",
        ...(graph ? ["-filter_complex", `[0:v]${filter}[out]`, "-map", "[out]"] : ["-vf", filter]),
        "-pix_fmt", "yuv420p", "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
