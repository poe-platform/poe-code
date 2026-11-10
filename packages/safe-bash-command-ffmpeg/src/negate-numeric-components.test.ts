import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: arithmetic and hexadecimal select blue; binary syntax fails
// before opening the output, preserving its existing contents.
for (const [components, exitCode, expected] of [
  ["2*2", 0, "1020cf40789a43de".repeat(3)],
  ["0b100", 234, Buffer.from("KEEP").toString("hex")],
  ["0x4", 0, "1020cf40789a43de".repeat(3)]
] as const) {
  it(`matches native negate components=${components} status and output bytes`, async () => {
    const input = Buffer.from("10203040789abcde".repeat(3), "hex");
    const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba",
        "-video_size", "2x1", "-framerate", "2", "-i", "in.raw",
        "-vf", `negate=components=${components}`, "-pix_fmt", "rgba", "-f", "rawvideo", "out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, exitCode, Buffer.concat(errors).toString());
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
