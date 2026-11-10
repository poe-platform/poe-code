import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = "10203040789abcde".repeat(3);

// The first two cases match FFmpeg 7.0.2 reference bytes for all three RGBA frames.
for (const [options, frame] of [
  ["components=r:components=+g", "efdf30408765bcde"],
  ["components=r+g", "efdf30408765bcde"],
  ["r:components=+g", "efdf30408765bcde"],
  ["components=r+g:components=-r", "10df30407865bcde"],
  ["components=r:components=g", "10df30407865bcde"],
  ["components=r:components=+g:components=-r", "10df30407865bcde"],
  ["components=0:components=+a", "102030bf789abc21"],
  ["components=r:components=none", "10203040789abcde"],
  ["components=+r:components=+g", "efdfcf40876543de"]
] as const) {
  it(`applies negate=${options} in assignment order`, async () => {
    const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
    volume.writeFileSync("/in.raw", Buffer.from(input, "hex"));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba",
        "-video_size", "2x1", "-framerate", "2", "-i", "/in.raw",
        "-vf", `negate=${options}`, "-pix_fmt", "rgba", "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), frame.repeat(3));
    assert.equal((volume.readFileSync("/in.raw") as Buffer).toString("hex"), input);
  });
}
