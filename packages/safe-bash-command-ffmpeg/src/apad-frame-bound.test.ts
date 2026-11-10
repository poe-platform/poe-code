import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [101, -901, 202, -802, 303, -703];
const input = Buffer.alloc(samples.length * 2);
samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));

for (const graph of [false, true]) {
  for (const [filter, options, expected] of [
    ["apad=packet_size=2", ["-frames:a", "0"], []],
    ["apad=packet_size=2", ["-ss", "2", "-frames:a", "0"], []],
    ["apad=packet_size=2", ["-ss", "2", "-frames:a", "1"], undefined],
    ["apad=packet_size=2", ["-frames:a", "1"], samples],
    ["apad=packet_size=2", ["-frames:a", "2"], [...samples, 0, 0, 0, 0]],
    ["apad=packet_size=2", ["-frames:a", "3"], [...samples, ...Array(8).fill(0)]],
    ["apad=packet_size=2:pad_len=12", ["-frames:a", "2"], [...samples, 0, 0, 0, 0]],
    ["apad=2", ["-aframes", "2"], [...samples, 0, 0, 0, 0]],
    ["apad=2", ["-frames:a:0", "2"], [...samples, 0, 0, 0, 0]],
    ["apad=2", ["-frames:0", "2"], [...samples, 0, 0, 0, 0]],
    ["apad=2:pad_len=-1:whole_len=-1", ["-frames:a", "2"], [...samples, 0, 0, 0, 0]],
    ["apad", ["-frames:a", "2"], [...samples, ...Array(8192).fill(0)]],
    ["asetnsamples=n=1:p=0,apad=2", ["-frames:a", "2"], samples.slice(0, 4)],
    ["asetnsamples=n=1:p=0,apad=2", ["-frames:a", "4"], [...samples, 0, 0, 0, 0]],
    ["apad=2", ["-frames:a", "2", "-t", "0.001"], [...samples, 0, 0, 0, 0]],
    ["apad=2", ["-frames:a", "1000000", "-t", "0.0005"], [...samples, 0, 0]],
    ["apad=2", [], undefined],
    ["apad=2", ["-frames:a:1", "2"], undefined],
    ["apad=2", ["-frames:v", "2"], undefined],
    ["apad=2", ["-frames:a", "1000000"], undefined],
    ["apad=packet_size=-1", ["-frames:a", "0"], undefined]
  ] as const) {
    it(`${filter} bounded by ${options.join(" ")} (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand({ limits: { maxDurationSeconds: 1 } }).execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          ...options, "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (expected === undefined) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)), expected);
      }
    });
  }
}
