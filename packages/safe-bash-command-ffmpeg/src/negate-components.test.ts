import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const rgb = "113a638cb5de07305982abd4fd264f78a1caf31c456e97c0";
const yuv = "113a638cb5de07305982abd4";

// FFmpeg 7.0.2 component bits: R=1, G=2, B=4, A=8, Y=16, U=32, V=64.
for (const [format, input, components, expected] of [
  ["rgb24", rgb, "1", "ee3a6373b5def830597dabd402264f87a1ca0c1c459197c0"],
  ["rgb24", rgb, "r", "ee3a6373b5def830597dabd402264f87a1ca0c1c459197c0"],
  ["rgb24", rgb, "2", "11c5638c4ade07cf598254d4fdd94f785ecaf3e3456e68c0"],
  ["rgb24", rgb, "g", "11c5638c4ade07cf598254d4fdd94f785ecaf3e3456e68c0"],
  ["rgb24", rgb, "4", "113a9c8cb5210730a682ab2bfd26b078a135f31cba6e973f"],
  ["rgb24", rgb, "b", "113a9c8cb5210730a682ab2bfd26b078a135f31cba6e973f"],
  ["rgb24", rgb, "1+g", "eec563734adef8cf597d54d402d94f875eca0ce3459168c0"],
  ["rgb24", rgb, "0", rgb],
  ["yuv420p", yuv, "16", "eec59c73b5def8cfa67dabd4"],
  ["yuv420p", yuv, "32", "113a638c4ade0730598254d4"],
  ["yuv420p", yuv, "64", "113a638cb52107305982ab2b"],
  ["yuv420p", yuv, "96", "113a638c4a2107305982542b"],
  ["rgb24", rgb, "8", null],
  ["rgb24", rgb, "64", null],
  ["yuv420p", yuv, "1", null],
  ["yuv420p", yuv, "2", null],
  ["yuv420p", yuv, "4", null]
] as const) {
  it(`uses FFmpeg 7 component bits for ${format} negate=components=${components}`, async () => {
    const volume = Volume.fromJSON({ "/out.raw": "preserved" });
    volume.writeFileSync("/in.raw", Buffer.from(input, "hex"));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", format,
        "-s", "2x2", "-r", "1", "-i", "/in.raw",
        "-vf", `negate=components=${components}`, "-pix_fmt", format, "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    if (expected === null) {
      assert.equal(result.exitCode, 234);
      assert.match(Buffer.concat(errors).toString(), /negate: Requested components not available/);
      assert.equal(volume.readFileSync("/out.raw", "utf8"), "");
    } else {
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    }
    assert.equal((volume.readFileSync("/in.raw") as Buffer).toString("hex"), input);
  });
}
