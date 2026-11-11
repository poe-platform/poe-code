import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// PCM16 output from FFmpeg 7.0.2 for eight mono samples at 8 kHz.
for (const [constant, numeric, expected] of [
  ["PI", "3.141592653589793", "4442445244624472ff7fff7fff7f34a9"],
  ["E", "2.718281828459045", "7e3b7e4b7e5b7e6b7e7bff7fff7f86bd"],
  ["PHI", "1.618033988749895", "e329e339e349e359e369e379ff7f56f2"]
] as const) {
  for (const expression of [constant, `i=${constant}`, `i=${constant}/2*2`, `i=${numeric}`]) {
    for (const complex of [false, true]) {
      it(`accepts crystalizer ${expression} in a ${complex ? "complex" : "simple"} filter`, async () => {
        const volume = Volume.fromJSON({
          "/in.raw": Buffer.from("00100020003000400050006000700040", "hex")
        });
        let stderr = "";
        const filters = complex
          ? ["-filter_complex", `[0:a]crystalizer=${expression}[out]`, "-map", "[out]"]
          : ["-af", `crystalizer=${expression}`];
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
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
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(expected, "hex"));
      });
    }
  }
}
