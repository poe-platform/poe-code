import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [0, 0, 0, 0, 9000, 9000, 0, 0, 0, 0, 4000, -4000, 0, 0, 0, 0, 0, 0,
  ...Array<number>(11).fill(7000), 0, 0, 0];

// Native FFmpeg reference samples and frame checksums, including the peak control.
for (const detection of ["dev", "5", "peak"]) {
  for (const format of ["s16le", "framecrc"]) for (const graph of [false, true]) {
    it(`matches native silenceremove detection=${detection} ${format} (graph=${graph})`, async () => {
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const filter = `silenceremove=stop_periods=-1:stop_threshold=0.12:window=5ms:detection=${detection}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
          "-f", format, "/out.raw"],
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
      const output = volume.readFileSync("/out.raw") as Buffer;
      if (format === "s16le") {
        const expected = detection === "peak"
          ? [...samples.slice(0, 9), ...samples.slice(10, 15), ...samples.slice(18, 29)] : samples.slice(0, 9);
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
      } else {
        const lines = output.toString().trim().split("\n");
        assert.ok(lines.includes("#tb 0: 1/1000"));
        assert.deepEqual(lines.filter(line => !line.startsWith("#")).map(line => line.split(",").map(v => v.trim())),
          [["0", "0", "0", detection === "peak" ? "25" : "9", detection === "peak" ? "50" : "18",
            detection === "peak" ? "0x8e240786" : "0x05000096"]]);
      }
    });
  }
}
