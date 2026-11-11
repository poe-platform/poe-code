import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native Linux FFmpeg 7.0.2 statuses and bytes for two 2x2 gray frames at 25 fps.
const input = Buffer.from("0d141b222930373e", "hex");
for (const [direction, flipped] of [["hflip", "140d221b30293e37"], ["vflip", "1b220d14373e2930"]] as const) {
  for (const [option, exitCode] of [
    ["=bogus=1", 8], ["=enable=bogus", 234], ["=1", 234],
    ["=enable=1:typo=1", 8], ["=enable=", 234], ["=enable=(1", 234],
    ["=enable=1::", 234], ["", 0], ["=enable=1", 0], ["=enable=0", 0]
  ] as const) {
    for (const filterOption of ["-vf", "-filter_complex"]) {
      for (const target of ["pipe:1", "/out.raw"]) {
        it(`${direction}${option} returns native status through ${filterOption} to ${target}`, async () => {
          const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
          const before = volume.toJSON();
          const output: Uint8Array[] = [];
          const errors: Uint8Array[] = [];
          const result = await createFfmpegCommand().execute({
            args: ["-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "2x2",
              "-i", "/in.raw", filterOption, direction + option, "-pix_fmt", "gray", "-f", "rawvideo", target],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
            stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
          } as never);
          const stderr = Buffer.concat(errors).toString();
          assert.equal(result.exitCode, exitCode, stderr);
          assert.deepEqual(volume.readFileSync("/in.raw"), input);
          if (exitCode !== 0) {
            assert.ok(stderr.includes(direction), stderr);
            assert.equal(Buffer.concat(output).length, 0);
            assert.deepEqual(volume.toJSON(), before);
          } else {
            assert.equal(stderr, "");
            const expected = option === "=enable=0" ? input : Buffer.from(flipped, "hex");
            if (target === "pipe:1") {
              assert.deepEqual(Buffer.concat(output), expected);
              assert.deepEqual(volume.toJSON(), before);
            } else {
              assert.deepEqual(volume.readFileSync(target), expected);
              assert.equal(Buffer.concat(output).length, 0);
            }
          }
        });
      }
    }
  }
}
