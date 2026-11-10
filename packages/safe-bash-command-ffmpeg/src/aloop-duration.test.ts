import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2-static, mono s16le at 1 kHz.
for (const graph of [false, true]) {
  for (const [start, duration, expected, frames] of [
    [2, "0.012", [1, 2, 3, 4, 5, 6, 7, 8, 3, 4],
      [[0, 4, "0x10a80334"], [6, 2, "0x03500122"], [6, 2, "0x025000d2"], [10, 2, "0x04500172"]]],
    [2, undefined, [1, 2, 3, 4, 5, 6, 7, 8, 3, 4, 7, 8, 9, 10],
      [[0, 4, "0x10a80334"], [6, 2, "0x03500122"], [6, 2, "0x025000d2"], [10, 4, "0x0c680244"], [14, 2, "0x01500082"]]],
    [0, "0.012", [1, 2, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8],
      [[0, 4, "0x10a80334"], [4, 4, "0x10a80334"], [8, 4, "0x0a2801f4"]]],
    [2, "0.005", [1, 2, 3, 4],
      [[0, 4, "0x10a80334"]]],
    [2, "0.015", [1, 2, 3, 4, 5, 6, 7, 8, 3, 4, 7, 8, 9],
      [[0, 4, "0x10a80334"], [6, 2, "0x03500122"], [6, 2, "0x025000d2"], [10, 4, "0x0c680244"], [14, 1, "0x0073004b"]]],
    [3, "0.008", [1, 2, 3, 4, 5, 8],
      [[0, 4, "0x10a80334"], [7, 1, "0x0123009b"], [7, 1, "0x009f005f"]]],
    [6, "0.012", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      [[0, 4, "0x10a80334"], [4, 4, "0x0a2801f4"], [10, 2, "0x01500082"]]]
  ] as const) {
    for (const format of ["s16le", "framecrc"]) {
      it(`aloop start=${start}, duration=${duration} matches native ${format} (${graph ? "graph" : "simple"})`, async () => {
        const input = Buffer.alloc(20);
        for (let i = 0; i < 10; i++) input.writeInt16LE((i + 1) * 1000, i * 2);
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = `aloop=loop=1:size=4:start=${start}`;
        const output: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            ...(duration === undefined ? [] : ["-t", duration]), "-f", format, "-"],
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
        const bytes = Buffer.concat(output);
        if (format === "s16le") {
          assert.deepEqual(Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2)),
            expected.map(sample => sample * 1000));
        } else {
          const rows = bytes.toString().trim().split("\n").filter(line => !line.startsWith("#"))
            .map(line => line.split(",").map(value => value.trim()));
          assert.deepEqual(rows, frames.map(([pts, count, crc]) =>
            ["0", String(pts), String(pts), String(count), String(count * 2), crc]));
        }
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
