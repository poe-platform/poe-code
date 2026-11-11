import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// PCM and option statuses measured with FFmpeg 7.0.2, in both filter paths.
for (const [options, repeats, size] of [
  ["1:3:0", 1, 3],
  ["1:3:0:", 1, 3],
  ["loop=1:size=3:start=0:", 1, 3],
  ["1:3:0::", null, 3],
  ["loop=1:size=3:start=0::", null, 3],
] as const) {
  for (const graph of [false, true]) {
    it(`aloop=${options} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(11 * 2);
      for (let i = 0; i < 11; i++) {
        input.writeInt16LE(1 + i, i * 2);
      }
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const filter = `aloop=${options}`;
      let stderr = "";
      const stdout: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (repeats === null) {
        assert.equal(result.exitCode, 234, stderr);
        assert.equal(Buffer.concat(stdout).length, 0);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat([
          ...Array.from({ length: repeats }, () => input.subarray(0, size * 2)), input
        ]));
      }
    });
  }
}
