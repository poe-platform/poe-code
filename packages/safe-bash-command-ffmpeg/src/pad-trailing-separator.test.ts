import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [options, left] of [
  ["4:4", 0], ["4:4:", 0], ["4:4:1", 1], ["4:4:1:", 1],
  ["4:4::1", null], ["4:4:1::", null], ["4:4:x=", null]
] as const) {
  it(`handles pad=${options} without changing empty-coordinate validation`, async () => {
    const input = Buffer.from([50, 30, 212, 255, 120, 180, 60, 128, 80, 140, 190, 64, 18, 47, 199, 0]);
    const volume = Volume.fromJSON({ "/in.rgba": input, "/o.raw": "KEEP" });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "2x2",
        "-framerate", "4", "-i", "/in.rgba", "-vf", `pad=${options}`, "-fps_mode", "passthrough",
        "-pix_fmt", "rgba", "-f", "rawvideo", "/o.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    if (left === null) {
      assert.equal(result.exitCode, 1);
      assert.equal(volume.readFileSync("/o.raw", "utf8"), "KEEP");
      return;
    }
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const expected = Buffer.alloc(4 * 4 * 4);
    for (let offset = 3; offset < expected.length; offset += 4) expected[offset] = 255;
    expected.set(input.subarray(0, 8), left * 4);
    expected.set(input.subarray(8), (4 + left) * 4);
    assert.deepEqual(volume.readFileSync("/o.raw"), expected);
  });
}
