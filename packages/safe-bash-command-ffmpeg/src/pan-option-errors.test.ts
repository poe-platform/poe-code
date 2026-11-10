import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [expression, exitCode, diagnostic] of [
  ["mono|c0=c1:unknown=1", 8, "pan: unsupported option unknown"],
  ["mono|c0=c1:enable=1", 176, "pan: unsupported option enable"],
  ["mono|c0=c1|c0=c0", 234, "pan: duplicate output channel"],
  ["mono|c0=c1", 0, ""]
] as const) {
  for (const complex of [false, true]) {
    it(`reports pan option errors (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const volume = new Volume();
      const input = [1, 4, 3, -4, -3, 6, 301, 711, 12001, -31999, 30000, 30000, -30000, -30000, 32767, -32768];
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
      assert.equal(result.exitCode, exitCode, stderr);
      if (exitCode !== 0) {
        assert.ok(stderr.includes(diagnostic), stderr);
        assert.equal(volume.existsSync("/out.raw"), false);
        return;
      }
      const expected = [4, -4, 6, 711, -31999, 30000, -30000, -32768];
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, expected.length * 2);
      assert.deepEqual(expected.map((_, index) => output.readInt16LE(index * 2)), expected);
    });
  }
}
