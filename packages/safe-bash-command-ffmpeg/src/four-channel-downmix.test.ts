import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg PCM16 output, including isolated speakers and negative full scale.
const samples = [1000, 0, 0, 0, 0, 0, 1000, 1000,
  32767, 0, 0, 0, 0, 32767, 0, 0, 0, 0, 32767, 0, 0, 0, 0, 32767,
  -32768, -32768, -32768, -32768];
for (const layout of [undefined, "4.0", "quad"]) {
  for (const downmix of [false, true]) {
    it(`converts ${layout ?? "default four-channel"} PCM with downmix=${downmix}`, async () => {
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
      const volume = Volume.fromJSON({ "/in.raw": input });
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "4",
          ...(layout ? ["-ch_layout", layout] : []), "-i", "/in.raw", "-bitexact",
          ...(downmix ? ["-ac", "2"] : []), "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const expected = !downmix ? samples : layout === "quad"
        ? [586, 0, 414, 414, 19194, 0, 0, 19194, 13573, 0, 0, 13573, -32768, -32768]
        : [453, 0, 547, 547, 14847, 0, 0, 14847, 10498, 10498, 7423, 7423, -32768, -32768];
      const output = Buffer.concat(stdout);
      assert.equal(output.length, expected.length * 2);
      assert.deepEqual(Array.from({ length: expected.length }, (_, i) => output.readInt16LE(i * 2)), expected);
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
