import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000];
const padded = [...samples, 0, 0, 0, 0];
const faded = [0, 1000, ...samples.slice(2), 0, 0, 0, 0];
const input = Buffer.alloc(samples.length * 2);
samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));

for (const graph of [false, true]) {
  for (const padding of ["", ":pad_len=20"]) {
    for (const [middle, expected] of [
      ["", padded],
      ["aformat=sample_fmts=s16,", padded],
      ["aformat@format=f=s16,", padded],
      ["aformat=s16:1000:mono,", padded],
      ["afade=t=in:ns=2,", faded],
      ["afade@fade=t=in:ns=2,", faded],
      ["aformat=f=s16:r=1000,afade=t=in:ns=2,", faded]
    ] as const) {
      it(`apad${padding} honors a sample bound through ${middle || "no filter"} (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        let stderr = "";
        const filter = `apad=packet_size=3${padding},${middle}atrim=end_sample=12`;
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
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
        assert.equal(result.exitCode, 0, stderr);
        const bytes = Buffer.alloc(expected.length * 2);
        expected.forEach((sample, index) => bytes.writeInt16LE(sample, index * 2));
        assert.deepEqual(volume.readFileSync("/out.raw"), bytes);
      });
    }
  }
  for (const tail of [
    "aformat=sample_fmts=s16",
    "afade=t=in:ns=2,atrim=end_sample=1000",
    "aformat=sample_rates=2000,atrim=end_sample=12",
    "aformat=r=2000,atrim=end_sample=12",
    "aformat=s16:2000,atrim=end_sample=12"
  ]) {
    it(`apad rejects an unsafe bound through ${tail} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const filter = `apad=packet_size=3,${tail}`;
      const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 0.1 } }).execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
