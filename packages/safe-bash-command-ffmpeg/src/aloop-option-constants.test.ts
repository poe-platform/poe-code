import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Status and PCM measured with FFmpeg 7.0.2-static: mono s16le at 8 kHz.
const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const repeated = [1, 2, 3, ...original];
for (const graph of [false, true]) {
  for (const [options, expected] of [
    ["loop=1:size=3:start=0", repeated],
    ["loop=1:size=3:start=none", repeated],
    ["loop=1:size=3:start=default", repeated],
    ["loop=0:size=3", original],
    ["loop=default:size=3", original],
    ["loop=none:size=3", original],
    ["loop=1:size=0", original],
    ["loop=1:size=min", original],
    ["loop=1:size=default", original],
    ["loop=1:size=none", original],
    ["loop=max:size=0", original],
    ["loop=0:size=max", original],
    ["loop=1:size=3:start=max", original],
    ["loop=1:size=3:start=min", original],
    ["loop=1:size=3:start=all", original],
    ["loop=min:size=3", Array.from({ length: 24 }, (_, i) => i % 3 + 1)],
    ["loop=all:size=3", Array.from({ length: 24 }, (_, i) => i % 3 + 1)],
    ["1:default+3:none+default", repeated],
    ["1:max-max+3:0", repeated],
    ["loop=2:loop=default:size=3", original],
    ["loop=1:size=3:size=default", original],
    ["loop=1:size=3:start=2:start=default", repeated],
    ["loop=1:size=3:start=unknown", null],
    ["loop=1:size=3:start=default+unknown", null],
    ["loop=1:size='min(3,4)'", null],
    ["loop=1:size='max(3,4)'", null],
  ] as const) {
    it(`aloop=${options} resolves numeric option constants (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(original.length * 2);
      original.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const filter = `aloop=${options}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
          "-t", "0.003", "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, expected === null ? 234 : 0, stderr);
      if (expected === null) {
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
