import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// PCM and option statuses measured with FFmpeg 7.0.2, in both filter paths.
for (const [options, repeats, size] of [
  ["loop=1+1:size=3", 2, 3],
  ["loop=1.5:size=3", 2, 3],
  ["loop=2.5:size=3", 2, 3],
  ["loop=PI:size=3", 3, 3],
  ["loop=2:size=3.5", 2, 4],
  ["loop=0b10:size=3", null, 3],
  ["loop=0o2:size=3", null, 3],
  ["loop=0x2:size=3", 2, 3],
  ["1+1:3.5:0.5", 2, 4],
  ["loop=2:size=0b11", null, 3],
  ["loop=2:size=0o3", null, 3],
  ["loop=2:size=3:start=0b0", null, 3],
  ["loop=2:size=3:start=0o0", null, 3],
] as const) {
  for (const graph of [false, true]) {
    it(`aloop=${options} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(8 * 4);
      for (let i = 0; i < 8; i++) {
        input.writeInt16LE(101 + i, i * 4);
        input.writeInt16LE(-901 - i, i * 4 + 2);
      }
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const filter = `aloop=${options}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (repeats === null) {
        assert.equal(result.exitCode, 234, stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat([
          ...Array.from({ length: repeats }, () => input.subarray(0, size * 4)), input
        ]));
      }
    });
  }
}
