import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// PCM and numeric diagnostics checked against native FFmpeg 7.0.2.
for (const complex of [false, true]) {
  for (const [filter, level, start, end, printed] of [
    ["atrim=start_sample=print(3)", "info", 3, 20, [3, 3]],
    [String.raw`atrim=start_sample=2:end_sample=print(5\,32)`, "info", 2, 5, [5, 5]],
    ["atrim=start_sample=3", "info", 3, 20, []],
    ["atrim=start_sample=print(3)", "error", 3, 20, []],
    ["atrim=start_sample='print(3,48)'", "info", 3, 20, []],
    ["atrim=start_sample='print(3,48)'", "debug", 3, 20, [3, 3]],
    ["atrim=start_sample='print(3,16)':end_sample=print(5)", "error", 3, 5, [3]],
    ["atrim=start_sample='print(3,16)':end_sample=print(5)", "info", 3, 5, [3, 5, 3, 5]],
    ["atrim=start_sample='if(0,print(7),print(3))'", "info", 3, 20, [3, 3]],
    ["atrim=start_sample='ifnot(1,print(7),print(3))'", "info", 3, 20, [3, 3]],
    ["atrim=start_sample=print(2.5)", "info", 2, 20, [2.5, 2.5]],
    ["atrim=start_sample=print(3):start_sample=print(5)", "info", 5, 20, [3, 5, 3, 5]],
    ["atrim=start_sample=print(3),atrim=end_sample=print(5)", "info", 3, 8, [3, 5, 3, 5]],
    ["apad,atrim=end_sample=print(23)", "info", 0, 23, [23, 23]],
    ["atrim=start_pts=print(3):end_pts=print(5)", "info", 3, 5, [3, 5, 3, 5]]
  ] as const) {
    it(`${filter} prints at ${level} (${complex ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(40);
      for (let i = 0; i < 20; i++) input.writeInt16LE(100 + i, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      let stderr = "";
      const output: Buffer[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", level, "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter},ashowinfo[s]`, "-map", "[s]"] : ["-af", `${filter},ashowinfo`]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const expected = Buffer.alloc((end - start) * 2);
      input.copy(expected, 0, start * 2, Math.min(end, 20) * 2);
      assert.deepEqual(Buffer.concat(output), expected);
      assert.deepEqual(stderr.split("\n").filter(line => line !== "" && Number.isFinite(Number(line))),
        printed.map(value => value.toFixed(6)), stderr);
    });
  }
}
