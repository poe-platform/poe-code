import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createCommandArguments } from "safe-bash-contracts";
import { createFfmpegCommand } from "./index.js";

const levels = [20, 50, 65, 100, 140, 170, 180, 205, 221];

// Native FFmpeg 7.0.2 selections: default 32x32 blocks have no complete
// comparison window on 16x16 input, but do detect scene changes on 32x32.
for (const [size, expected] of [
  [16, [20, 65, 100, 170, 180, 205, 221]],
  [32, [50, 65, 100, 170, 180, 205, 221]]
] as const) {
  for (const chroma of ["", ":chroma=0", ":chroma=1"]) {
    it(`decimate preserves native gray frame selection at ${size}x${size}${chroma}`, async () => {
      const input = Buffer.concat(levels.map(value => Buffer.alloc(size * size, value)));
      const volume = Volume.fromJSON({ "/in.gray": input });
      const argumentValues = createCommandArguments([
        "-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${size}x${size}`,
        "-r", "4", "-i", "/in.gray", "-vf", `decimate=cycle=4${chroma}`,
        "-fps_mode", "passthrough", "-pix_fmt", "gray", "-bitexact", "-f", "rawvideo", "pipe:1"
      ]);
      const output: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        command: "ffmpeg", args: argumentValues.args, argumentValues,
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const bytes = Buffer.concat(output);
      assert.equal(bytes.length, expected.length * size * size);
      assert.deepEqual(expected.map((_, i) => bytes[i * size * size]), expected);
      assert.deepEqual(bytes, Buffer.concat(expected.map(value => Buffer.alloc(size * size, value))));
      assert.deepEqual(volume.readFileSync("/in.gray"), input);
    });
  }
}
