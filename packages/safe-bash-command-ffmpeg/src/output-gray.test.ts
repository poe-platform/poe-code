import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Two 32x16 H.264 frames at 2 fps, distinct left/right luma, U=85 and V=195.
const input = readFileSync(new URL("./fixtures/gray-encode.mp4", import.meta.url));

for (const format of ["gray", "gray8", "yuv420p"]) {
  for (const flip of [false, true]) {
    it(`encodes ${format} with both frames and preserved luma (hflip=${flip})`, async () => {
      const volume = Volume.fromJSON({ "/input.mp4": input });
      const run = async (args: string[]) => {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      };
      await run(["-i", "/input.mp4", "-pix_fmt", "yuv420p", "-f", "rawvideo", "/input.yuv"]);
      await run(["-i", "/input.mp4", ...(flip ? ["-vf", "hflip"] : []),
        "-c:v", "libx264", "-pix_fmt", format, "/output.mp4"]);
      await run(["-i", "/output.mp4", "-pix_fmt", "yuv420p", "-f", "rawvideo", "/output.yuv"]);
      const original = volume.readFileSync("/input.yuv") as Buffer;
      const actual = volume.readFileSync("/output.yuv") as Buffer;
      assert.equal(actual.length, 2 * 768);
      for (let frame = 0; frame < 2; frame++) {
        const start = frame * 768;
        // The encoder converts through RGB; allow rounding and clipped saturated colors.
        for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
          const expected = original[start + y * 32 + (flip ? 31 - x : x)]!;
          assert.ok(Math.abs(actual[start + y * 32 + x]! - expected) <= 6, `preserve flipped luma: ${actual[start + y * 32 + x]} vs ${expected}`);
        }
        for (let i = 512; i < 768; i++) {
          if (format === "yuv420p") assert.ok(i < 640 ? actual[start + i]! < 110 : actual[start + i]! > 165, "retain input color");
          else assert.equal(actual[start + i], 128, `frame ${frame} chroma ${i}`);
        }
      }
    });
  }
}
