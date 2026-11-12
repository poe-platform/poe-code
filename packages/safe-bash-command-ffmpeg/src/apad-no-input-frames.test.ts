import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 leaves generated PTS missing when apad receives no frames.
// The output muxer still assigns sequential packet timestamps starting at zero.
for (const graph of [false, true]) {
  for (const [upstream, selector, format, expected] of [
    ["aselect=0", "isnan(pts)", "s16le", [0, 0, 0]],
    ["aselect=0", "not(isnan(pts))", "s16le", []],
    ["atrim=end_sample=0", "isnan(pts)", "s16le", [0, 0, 0]],
    ["atrim=end_sample=0", "not(isnan(pts))", "s16le", []],
    ["aselect=0", "", "s16le", [0, 0, 0]],
    ["atrim=end_sample=0", "", "s16le", [0, 0, 0]],
    ["aselect=1", "isnan(pts)", "s16le", []],
    ["aselect=1", "not(isnan(pts))", "s16le", [101, 0, 0, 0]],
    ["asetpts=NAN", "isnan(pts)", "s16le", [101]],
    ["aselect=0", "", "framecrc", [[0, 0, 0, 2, 4, 0], [0, 2, 2, 1, 2, 0]]],
    ["atrim=end_sample=0", "", "framecrc", [[0, 0, 0, 2, 4, 0], [0, 2, 2, 1, 2, 0]]]
  ] as const) {
    for (const duration of selector === "" && format === "s16le" ? [false, true] : [false]) {
      it(`apad without input frames: ${upstream}, ${selector || "all"}, ${format}, duration=${duration} (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": Buffer.from([101, 0]) });
        const filter = `${upstream},apad=packet_size=2${duration ? "" : ":pad_len=3"}${selector ? `,aselect=${selector}` : ""}`;
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            ...(duration ? ["-t", "0.003"] : []), "-f", format, "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        const output = Buffer.concat(stdout);
        if (format === "framecrc") {
          assert.deepEqual(output.toString().split("\n").filter(line => line && !line.startsWith("#"))
            .map(line => line.split(",").map(value => Number(value.trim()))), expected);
        } else {
          assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)), expected);
        }
      });
    }
  }
}
