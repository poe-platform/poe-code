import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg sample order for a 4x2 frame, applied independently to Y, U and V.
const identity = [0, 1, 2, 3, 4, 5, 6, 7];
const cases = [
  ["null", identity, 4, 2],
  ["hflip", [3, 2, 1, 0, 7, 6, 5, 4], 4, 2],
  ["vflip", [4, 5, 6, 7, 0, 1, 2, 3], 4, 2],
  ["hflip,hflip", identity, 4, 2],
  ["vflip,vflip", identity, 4, 2],
  ["transpose=cclock_flip", [0, 4, 1, 5, 2, 6, 3, 7], 2, 4],
  ["transpose=clock", [4, 0, 5, 1, 6, 2, 7, 3], 2, 4],
  ["transpose=cclock", [3, 7, 2, 6, 1, 5, 0, 4], 2, 4],
  ["transpose=clock_flip", [7, 3, 6, 2, 5, 1, 4, 0], 2, 4],
  ["transpose=clock,transpose=cclock", identity, 4, 2],
  ["transpose=clock:landscape", identity, 4, 2]
] as const;

for (const depth of [10, 16]) {
  const bases = depth === 10 ? [65, 259, 771] : [0x1234, 0x4567, 0x89ab];
  const pixels = Buffer.alloc(48);
  bases.flatMap(base => identity.map(index => base + index))
    .forEach((value, index) => pixels.writeUInt16LE(value, index * 2));
  const input = Buffer.concat([
    Buffer.from(`YUV4MPEG2 W4 H2 F4:1 Ip A1:1 C444p${depth}\nFRAME\n`), pixels
  ]);
  for (const [filter, order, width, height] of cases) {
    for (const container of ["raw", "y4m"]) {
      for (const type of ["Buffer", "Uint8Array"]) {
        it(`${filter} preserves ${depth}-bit YUV444 samples in ${container} with ${type} input`, async () => {
          const volume = Volume.fromJSON({ "/in.y4m": input, [`/out.${container}`]: "KEEP" });
          const reads: Uint8Array[] = [];
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
              "-fps_mode", "passthrough", "-pix_fmt", `yuv444p${depth}le`,
              ...(container === "raw" ? ["-f", "rawvideo"] : []), `/out.${container}`],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) {
                const bytes = volume.readFileSync(path) as Buffer;
                const data = type === "Buffer" ? bytes : Uint8Array.from(bytes);
                reads.push(data);
                return data;
              },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          const output = volume.readFileSync(`/out.${container}`) as Buffer;
          let actual = output;
          if (container === "y4m") {
            const header = output.subarray(0, output.indexOf(10)).toString().split(" ");
            for (const field of [`W${width}`, `H${height}`, "F4:1", "A1:1", `C444p${depth}`]) {
              assert.ok(header.includes(field), `missing ${field} in ${header.join(" ")}`);
            }
            const marker = output.indexOf("FRAME\n");
            assert.notEqual(marker, -1);
            actual = output.subarray(marker + 6);
          }
          const expected = Buffer.alloc(48);
          bases.flatMap(base => order.map(index => base + index))
            .forEach((value, index) => expected.writeUInt16LE(value, index * 2));
          assert.deepEqual(actual, expected);
          assert.ok(reads.length > 0);
          for (const bytes of reads) assert.deepEqual(Buffer.from(bytes), input, "input remains unchanged");
          assert.deepEqual(volume.readFileSync("/in.y4m"), input);
        });
      }
    }
  }
}
