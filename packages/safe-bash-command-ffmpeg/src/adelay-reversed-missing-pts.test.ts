import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: untimed reverse alone retains zero packet timestamps;
// delay's planar conversion makes the muxer synthesize a continuous timeline.
for (const complex of [false, true]) {
  for (const [filters, durations, timestamps, checksums] of [
    ["areverse,adelay=0S|3S", [5, 8, 8, 8, 3], [0, 5, 13, 21, 29], ["0x1390044c", "0xf7500fe0", "0xf6d00fe0", "0xf6500fe0", "0x20c505f7"]],
    ["areverse,adelay=0S|0S", [5, 8, 8, 8], [0, 5, 13, 21], ["0x5fe109fb", "0xf8d00ff8", "0xf8500ff8", "0xf7d00ff8"]],
    ["adelay=0S|3S", [8, 8, 8, 5, 3], [0, 8, 16, 24, 29], ["0x60450a10", "0xf9d01010", "0xfa501010", "0x60770a0a", "0x1f0105a9"]],
    ["areverse", [5, 8, 8, 8], [0, 0, 0, 0], ["0x5fe109fb", "0xf8d00ff8", "0xf8500ff8", "0xf7d00ff8"]],
    ["areverse,adelay=0S|3S,aselect='isnan(t)'", [], [], []],
    ["areverse,adelay=0S|0S,aselect='isnan(t)'", [], [], []]
  ] as const) {
    it(`matches untimed ${filters} packet timing (complex ${complex})`, async () => {
      const input = Buffer.alloc(29 * 4);
      for (let i = 0; i < 29; i++) {
        input.writeInt16LE(i + 1, i * 4);
        input.writeInt16LE(-i - 1, i * 4 + 2);
      }
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `asetnsamples=n=8:p=0,asetpts=NAN,${filters}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "framecrc", "/out"],
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
      const rows = volume.readFileSync("/out").toString().split("\n")
        .filter(line => line && !line.startsWith("#"))
        .map(line => line.split(",").map(field => field.trim()));
      assert.deepEqual(rows.map(row => row[5]), checksums);
      assert.deepEqual(rows.map(row => Number(row[3])), durations);
      assert.deepEqual(rows.map(row => Number(row[4])), durations.map(duration => duration * 4));
      assert.deepEqual(rows.map(row => Number(row[1])), timestamps);
      assert.deepEqual(rows.map(row => Number(row[2])), timestamps);
    });
  }
}
