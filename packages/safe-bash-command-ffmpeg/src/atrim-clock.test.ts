import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [filter, start, end] of [
    [String.raw`atrim=end='00\:00\:00.00025'`, 0, 2],
    [String.raw`atrim=start=00\\:00\\:00.00025`, 2, 12],
    ["atrim=duration=250us", 0, 2],
    [String.raw`atrim=duration='00\:00\:00.00025'`, 0, 2],
    [String.raw`atrim=starti='00\:00\:00.00025':endi=00\\:00\\:00.00075`, 2, 6],
    [String.raw`atrim=start='00\:00\:00.00025':durationi='00\:00\:00.0005'`, 2, 6],
    [String.raw`atrim='00\:00\:00.00025':'00\:00\:00.00075'`, 2, 6],
    [String.raw`atrim=end=\'00:00:00.00025\'`, 0, 2],
    [String.raw`atrim=end='00\:00\:00.0005',atrim=start_sample=2`, 2, 4],
    [String.raw`atrim=end='00\:00\:invalid'`, -1, 0],
    [String.raw`atrim=end='00\:60\:00'`, -1, 0],
    [String.raw`atrim=duration='-00\:00\:00.00025'`, -1, 0]
  ] as const) {
    it(`${filter} parses clock durations (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(24);
      for (let i = 0; i < 12; i++) input.writeInt16LE(i + 1, i * 2);
      const existing = Buffer.from([255, 127]);
      for (const outputExists of start < 0 ? [false, true] : [false]) {
        const volume = Volume.fromJSON({ "/in.raw": input,
          ...(outputExists ? { "/out.raw": existing } : {}) });
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
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
        if (start < 0) {
          assert.equal(result.exitCode, filter.startsWith("atrim=duration=") ? 222 : 234, stderr);
          assert.ok(stderr.includes("atrim: invalid"), stderr);
          if (outputExists) assert.deepEqual(volume.readFileSync("/out.raw"), existing);
          else assert.equal(volume.existsSync("/out.raw"), false);
        } else {
          assert.equal(result.exitCode, 0, stderr);
          assert.deepEqual(volume.readFileSync("/out.raw"), input.subarray(start * 2, end * 2));
        }
      }
    });
  }
}
