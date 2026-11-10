import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 stereo controls at 8 kHz.
for (const [enable, prefix, inputCount, outputLimit, paddingCount] of [
  [undefined, "", 3, "0.001", 2],
  ["1", "", 3, "0.001", 2],
  ["gte(t\\,0)", "", 3, "0.001", 2],
  ["eq(n\\,0)", "", 3, "0.001", 2],
  ["'gte(t,0)'", "", 3, "0.001", 2],
  ["gte(t\\,0.08)", "", 1025, "0.2", 2],
  ["gte(n\\,1)", "", 1025, "0.2", 2],
  ["gte(t\\,0.001)", "asetpts=PTS+8,", 3, "0.002", 2],
  ["0", "", 1025, "0.001", 0],
  ["bad", "", 3, "0.001", 0]
] as const) {
  for (const graph of [false, true]) {
    it(`apad enable=${enable ?? "unset"} (${graph ? "graph" : "simple"})`, async () => {
      const inputSamples = Array.from({ length: inputCount * 2 }, (_, index) => [101, -901, 202, -802, 303, -703][index % 6]!);
      const input = Buffer.alloc(inputSamples.length * 2);
      inputSamples.forEach((value, index) => input.writeInt16LE(value, index * 2));
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const filter = `${prefix}apad=pad_len=2${enable === undefined ? "" : `:enable=${enable}`}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-t", outputLimit, "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (enable === "bad") {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("apad enable: invalid or unsupported expression"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)),
          [...inputSamples, ...Array<number>(paddingCount * 2).fill(0)].slice(0, Math.round(Number(outputLimit) * 8000) * 2));
      }
    });
  }
}
