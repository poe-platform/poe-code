import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [layout, width, height] of [
  ["qcif", 176, 144], ["sqcif", 128, 96], ["qvga", 320, 240],
  ["ntsc-film", 352, 240], ["2kscope", 2048, 858],
  ["176x144", 176, 144], ["2x2", 2, 2], ["2/2", 2, 2],
  ["2X2", 2, 2], ["2-2", 2, 2], ["2a2", 2, 2], ["2 x2", 0, 0],
  ["+2/+2", 2, 2], ["02/02", 2, 2], ["2/ 2", 2, 2],
  ["QCIF", 0, 0], ["unknown", 0, 0], ["2//2", 0, 0],
  ["2/2junk", 0, 0], ["2/0", 0, 0], ["0/2", 0, 0],
  ["-2/2", 0, 0], ["2/-2", 0, 0], ["2", 0, 0],
  ["2147483648/1", 0, 0], ["65536/65536", 0, 0]
] as const) {
  for (const prefix of ["", "layout="]) {
    it(`tile accepts native image sizes or rejects invalid layout ${prefix}${layout}`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from([20]), "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", "gray",
          "-video_size", "1x1", "-framerate", "4", "-i", "/in.raw",
          "-vf", `tile=${prefix}${layout}:nb_frames=1`, "-fps_mode", "passthrough",
          "-pix_fmt", "gray", "-f", "rawvideo", "/out.raw"],
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
      if (width) {
        assert.equal(result.exitCode, 0, stderr);
        const expected = Buffer.alloc(width * height);
        expected[0] = 20;
        assert.deepEqual(output, expected);
        if (width === 176) {
          assert.equal(createHash("sha256").update(output).digest("hex"),
            "2148ebc369c14d954cf17eeda2beb4fe9af0aef631b534fbc85d7b1dad52ba89");
        }
      } else {
        assert.equal(result.exitCode, 234, stderr);
        assert.ok(stderr.includes("tile:"), stderr);
        assert.equal(output.toString(), "KEEP");
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), Buffer.from([20]));
    });
  }
}
