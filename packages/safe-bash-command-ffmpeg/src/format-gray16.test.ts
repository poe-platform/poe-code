import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: exit 0, exact samples retained in the requested byte order.
for (const source of ["pgm", "gray16le"]) {
  for (const format of ["gray16le", "gray16be"]) {
    for (const filter of [`format=${format}`, `format=pix_fmts=${format}`, `format=${format},negate`]) {
      it(`preserves 16-bit ${source} samples through ${filter}`, async () => {
        const volume = Volume.fromJSON({ "/in": Buffer.from(source === "pgm"
          ? "50350a3420310a36353533350a12343456789abcde" : "341256349a78debc", "hex") });
        const stdout: Uint8Array[] = [];
        const stderr: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", ...(source === "pgm" ? [] :
            ["-f", "rawvideo", "-pix_fmt", source, "-s", "4x1"]),
            "-i", "/in", "-vf", filter, "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
        assert.equal(Buffer.concat(stderr).toString(), "");
        const expected = Buffer.from(format === "gray16le" ? "341256349a78debc" : "12343456789abcde", "hex");
        assert.deepEqual(Buffer.concat(stdout), filter.endsWith(",negate") ? expected.map(value => 255 - value) : expected);
      });
    }
  }
}
