import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [expression, expected] of [
  ["stereo|c0=c0|", [101, 0, 202, 0, 303, 0]],
  ["stereo|c0=c0||c1=c1", [101, -901, 202, -802, 303, -703]],
  ["stereo|c0=c0", [101, 0, 202, 0, 303, 0]],
  ["stereo|c0=c0||c1=", null],
  ["stereo|c0=c0||c0=c1", null]
] as const) {
  for (const complex of [false, true]) {
    it(`handles empty pan equations (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const volume = new Volume();
      const input = [101, -901, 202, -802, 303, -703];
      const pcm = Buffer.alloc(input.length * 2);
      input.forEach((sample, index) => pcm.writeInt16LE(sample, index * 2));
      volume.writeFileSync("/in.raw", pcm);
      let stderr = "";
      const filters = complex
        ? ["-filter_complex", `[0:a]pan=${expression}[s]`, "-map", "[s]"]
        : ["-af", `pan=${expression}`];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...filters, "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (expected === null) {
        assert.equal(result.exitCode, 1);
        assert.ok(stderr.includes("pan:"), stderr);
        assert.equal(volume.existsSync("/out.raw"), false);
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, expected.length * 2);
      assert.deepEqual(expected.map((_, index) => output.readInt16LE(index * 2)), expected);
    });
  }
}
