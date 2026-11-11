import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 1x1 gray fields at 2 fps, with passthrough output timing.
for (const [count, filter, expected, timestamps] of [
  [3, "weave", "0d14", [0]],
  [2, "doubleweave", "0d14", [0]],
  [3, "weave,fps=2", "0d140d140d140d14", [0, 1, 2, 3]],
  [2, "weave,fps=2", "0d140d14", [0, 1]],
  [2, "doubleweave,fps=2", "0d140d14", [0, 1]],
  [3, "doubleweave,fps=2", "0d141b141b14", [0, 1, 2]],
  [5, "select=lt(n\\,3),weave,fps=2", "0d140d140d140d140d140d14", [0, 1, 2, 3, 4, 5]],
  [4, "select=lt(n\\,2),doubleweave,fps=2", "0d140d140d140d14", [0, 1, 2, 3]],
  [3, "weave,fps=2:round=down", "0d140d140d140d14", [0, 1, 2, 3]],
  [3, "weave,settb=1/2,fps=2", "0d140d140d140d14", [0, 1, 2, 3]],
  [1, "weave,fps=2", "", []],
  [1, "doubleweave,fps=2", "", []]
] as const) {
  it(`preserves native EOF timing for ${count} fields through ${filter}`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": Buffer.from(Array.from({ length: count }, (_, i) => 13 + 7 * i)) });
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
        "-s", "1x1", "-r", "2", "-i", "/in.raw", "-vf", `${filter},showinfo`,
        "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(data: Uint8Array) { stdout.push(data.slice()); } },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(Buffer.concat(stdout).toString("hex"), expected);
    const frames = stderr.split("\n").filter(line => line.includes(" pts:"));
    assert.deepEqual(frames.map(line => Number(line.split(" pts:")[1]!.trim().split(" ")[0])), timestamps);
  });
}
