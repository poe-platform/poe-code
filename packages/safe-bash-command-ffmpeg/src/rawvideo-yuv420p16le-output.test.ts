import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.from(Array.from({ length: 7 }, (_, i) => [16 * (i + 1), 16 * (i + 1) + 1, 16 * (i + 1), 16 * (i + 1) + 1]).flat());
// Complete native FFmpeg 7.0.2 output for the seven 2x2 gray frames.
const cases = [
  ["null", "yuv420p16le", "be1d9a1ebe1d9a1e008000807b2b572c7b2b572c008000803839143a3839143a00800080f546d147f546d14700800080b2548e55b2548e55008000806f624b636f624b63008000802c7008712c70087100800080"],
  ["tile=2x1", "yuv420p16le", "be1d9a1e7b2b572cbe1d9a1e7b2b572c00800080008000803839143af546d1473839143af546d1470080008000800080b2548e556f624b63b2548e556f624b6300800080008000802c700871011001102c700871011001100080008000800080"],
  ["null", "gray", "10111011202120213031303140414041505150516061606170717071"]
] as const;

for (const [filter, format, expected] of cases) {
  for (const maxOutputBytes of [expected.length / 2, expected.length / 2 - 1]) {
    it(`encodes gray through ${filter} as ${format} with output limit ${maxOutputBytes}`, async () => {
      const volume = Volume.fromJSON({ "/in.gray": input, "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand({ limits: { maxOutputBytes } }).execute({
        args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x2",
          "-framerate", "6", "-i", "/in.gray", "-vf", filter, "-fps_mode", "passthrough",
          "-pix_fmt", format, "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      const output = volume.readFileSync("/out.raw") as Buffer;
      if (maxOutputBytes === expected.length / 2) {
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(output.toString("hex"), expected);
      } else {
        assert.notEqual(result.exitCode, 0);
        assert.match(stderr, /maxOutputBytes/);
        assert.equal(output.toString(), "KEEP");
      }
      assert.deepEqual(volume.readFileSync("/in.gray"), input);
    });
  }
}
