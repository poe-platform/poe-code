import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Array.from({ length: 23 }, (_, i) => [i * 601 - 5000, i * 601 - 4903]);
const prefix = input.slice(0, 18).flat();
const reversedPrefix = [...input].reverse().slice(0, 18).flat();
const transition = [-2076, -1999, -2798, -2720, -3038, -2960, -2798, -2720, -2076, -1999];
const prefixRow = "0,0,0,18,72,0x89a32517";
const reversedRow = "0,0,0,18,72,0xfadb1b53";

// Complete stereo PCM and framecrc rows captured from native FFmpeg 7.0.2.
for (const [first, second, overlap, expected, rows] of [
  ["anull", "atrim=end_sample=10", 1, prefix, [prefixRow]],
  ["areverse", "atrim=end_sample=10", 1, reversedPrefix, [reversedRow]],
  ["areverse", "atrim=end_sample=10", 0, reversedPrefix, [reversedRow]],
  ["areverse", "anull", 1, reversedPrefix, [reversedRow]],
  ["areverse", "asetnsamples=n=7:p=0", 1, [...reversedPrefix, ...transition, ...input.slice(5).flat()],
    [reversedRow, "0,18,18,5,20,0x885e0d3a", "0,23,23,2,8,0x18ca062c", "0,25,25,7,28,0xda6e0c15",
      "0,32,32,7,28,0x6432070f", "0,39,39,2,8,0x0a630203"]],
  ["anull", "acopy,atrim@trim=start_sample=3:end_sample=10,anull", 0, prefix, [prefixRow]],
  ["areverse", "atrim=end_sample=10,asetnsamples=n=7:p=0", 1,
    [...reversedPrefix, ...transition, ...input.slice(5, 10).flat()],
    [reversedRow, "0,18,18,5,20,0x885e0d3a", "0,23,23,2,8,0x18ca062c", "0,25,25,3,12,0x3773079c"]],
  ["anull", "atrim=end_sample=10,areverse", 1,
    [...prefix, 4654, 4732, 3812, 3890, 2490, 2568, 687, 765, -1596, -1518, ...input.slice(0, 5).reverse().flat()],
    [prefixRow, "0,18,18,5,20,0x3dc5074f", "0,23,23,5,20,0x9b980ef1"]]
] as const) {
  for (const format of ["s16le", "framecrc"]) {
    it(`acrossfade split ${first} / ${second}, overlap=${overlap}, ${format}`, async () => {
      const raw = Buffer.alloc(input.length * 4);
      input.flat().forEach((sample, i) => raw.writeInt16LE(sample, i * 2));
      const volume = Volume.fromJSON({ "/in.raw": raw });
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          "-filter_complex", `[0:a]asplit=2[a][b];[a]${first}[ra];[b]${second}[tb];` +
            `[ra][tb]acrossfade=ns=5:o=${overlap}[out]`, "-map", "[out]", "-c:a", "pcm_s16le", "-f", format, "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const output = Buffer.concat(chunks);
      if (format === "s16le") {
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
      } else {
        assert.deepEqual(output.toString().trim().split("\n").filter(line => !line.startsWith("#"))
          .map(line => line.split(",").map(value => value.trim()).join(",")), rows);
      }
    });
  }
}
