import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = [101, -901, 202, -802, 303, -703];
for (const complex of [false, true]) {
  for (const [filter, start, end, outputDuration] of [
    ["apad,atrim=end_sample=8", 0, 8],
    ["apad,atrim=duration=0.001", 0, 8],
    ["apad,atrim=start_sample=2:end_sample=8", 2, 8],
    ["apad,atrim=start_sample=5:end_sample=8", 5, 8],
    ["apad,atrim=start_sample=5:duration=0.001", 5, 13],
    ["apad,atrim=start=0.000625:duration=0.001", 5, 13],
    ["apad,atrim=end_sample=0", 0, 0],
    ["apad,atrim=end=0.001", 0, 8],
    ["apad,atrim=end_pts=8", 0, 8],
    ["apad,atrim=end_sample=6:end=0.001", 0, 8],
    ["apad,atrim=end_sample=8:duration=0.0005", 0, 8],
    ["apad,atrim=end_sample=4:end_sample=8", 0, 8],
    ["apad,atrim=end_sample=2*4", 0, 8],
    ["apad,atrim=durationi=0.001", 0, 8],
    ["apad@pad,atrim@trim=0:0.001", 0, 8],
    ["asetpts=PTS+8,apad,atrim=end_pts=16", 0, 8],
    ["asetpts=PTS-8,apad,atrim=end_pts=0", 0, 8],
    ["apad=packet_size=2,atrim=start_sample=5:duration=0.001", 5, 13],
    ["apad=pad_len=12,atrim=end_sample=8", 0, 8],
    ["apad,atrim=end_sample=80000", 0, 8, "0.001"]
  ] as const) {
    it(`${filter} is bounded by atrim (${complex ? "complex" : "simple"})`, async () => {
      const bytes = Buffer.alloc(input.length * 2);
      input.forEach((value, index) => bytes.writeInt16LE(value, index * 2));
      const volume = Volume.fromJSON({ "/in.raw": bytes, "/out.raw": "KEEP" });
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 0.01 } }).execute({
        args: ["-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          ...(outputDuration === undefined ? [] : ["-t", outputDuration]), "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      const actual = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(Array.from({ length: actual.length / 2 }, (_, i) => actual.readInt16LE(i * 2)),
        Array.from({ length: (end - start) * 2 }, (_, i) => input[start * 2 + i] ?? 0));
    });
  }
}

for (const complex of [false, true]) {
  for (const filter of [
    "apad,atrim", "apad,atrim=duration=0", "apad,atrim=start_sample=2",
    "atrim=end_sample=8,apad", "apad,asetpts=2*PTS,atrim=end_pts=8",
    "apad,atrim=end_sample=80000", "apad,atrim=start_sample=80000:duration=0.001",
    "apad,atrim=end_sample=bad", "apad,atrim=duration=-1"
  ]) {
    it(`${filter} preserves the destination when unbounded, invalid, or over budget (${complex ? "complex" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.alloc(12), "/out.raw": "KEEP" });
      const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 0.01 } }).execute({
        args: ["-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
      } as never);
      assert.notEqual(result.exitCode, 0);
      assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
    });
  }
}
