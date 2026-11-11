import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const format of ["gray16be", "gray16le"]) {
  for (const size of [1, 2]) {
    for (const padding of [0, 1]) {
      it(`preserves ${format} ${size}x${size} source samples with ${padding}-pixel padding`, async () => {
        const input = Buffer.from(Array.from({ length: size * size * 2 }, (_, i) => 13 + 7 * i));
        const width = size + 2 * padding;
        const expected = Buffer.alloc(width * width * 2, 255);
        for (let row = 0; row < size; row++) {
          input.copy(expected, ((row + padding) * width + padding) * 2, row * size * 2, (row + 1) * size * 2);
        }
        const volume = Volume.fromJSON({ "/in.raw": input });
        const output: Uint8Array[] = [];
        const errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "rawvideo", "-pix_fmt", format, "-s", `${size}x${size}`,
            "-i", "/in.raw", "-vf", `pad=${width}:${width}:${padding}:${padding}:white`,
            "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        assert.deepEqual(Buffer.concat(output), expected);
      });
    }
  }
}
