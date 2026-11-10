import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 RGB24 references, with the destination initially absent.
for (const [components, exitCode, expected] of [
  ["default", 0, "efdfcfbfaf9f8f7f6f5f4f3f"],
  ["119", 0, "efdfcfbfaf9f8f7f6f5f4f3f"],
  ["all", 234, ""],
  ["127", 234, ""],
  ["all-a", 0, "efdfcfbfaf9f8f7f6f5f4f3f"],
  ["default-default", 0, "102030405060708090a0b0c0"]
] as const) {
  it(`matches native negate components=${components} status and output bytes`, async () => {
    const input = Buffer.from("102030405060708090a0b0c0", "hex");
    const volume = Volume.fromJSON({ "/in.raw": input });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgb24",
        "-video_size", "2x1", "-framerate", "2", "-i", "in.raw",
        "-vf", `negate=components=${components}`, "-pix_fmt", "rgb24", "-f", "rawvideo", "out.raw"],
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
    if (exitCode) assert.match(Buffer.concat(errors).toString(), /negate: Requested components not available/);
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
