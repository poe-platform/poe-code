import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: the full named color mask is the default; decimal 63 is not.
for (const [filter, exitCode, expected] of [
  ["negate=components=r+g+b+y+u+v", 0, "efdfcf40876543de".repeat(3)],
  ["negate=components=119", 0, "efdfcf40876543de".repeat(3)],
  ["negate=components=v+u+y+b+g+r", 0, "efdfcf40876543de".repeat(3)],
  ["negate=components=63", 234, ""],
  ["negate=components=r+y", 234, ""],
  ["negate=components=64", 234, ""],
  ["negate=components=8", 0, "102030bf789abc21".repeat(3)],
  ["negate", 0, "efdfcf40876543de".repeat(3)]
] as const) {
  it(`matches native RGBA status and output for ${filter}`, async () => {
    const input = Buffer.from("10203040789abcde".repeat(3), "hex");
    const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba",
        "-video_size", "2x1", "-framerate", "2", "-i", "/in.raw", "-vf", filter,
        "-pix_fmt", "rgba", "-f", "rawvideo", "/out.raw"],
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
    assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(expected, "hex"));
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
    if (exitCode !== 0) assert.ok(stderr.includes("negate: Requested components not available"), stderr);
    else assert.equal(stderr, "");
  });
}
