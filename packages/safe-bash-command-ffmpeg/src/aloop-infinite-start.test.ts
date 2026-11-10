import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2-static, mono s16le at 1 kHz.
for (const graph of [false, true]) {
  for (const [start, tail, options, expected] of [
    ["start=2", "", ["-t", "0.012"], [1, 2, 3, 4, 5, 6, 7, 8, 3, 4]],
    ["start=-1:time=0.002", "", ["-t", "0.012"], [1, 2, 3, 4, 5, 6, 7, 8, 5, 6, 7, 8]],
    ["start=12", "", ["-t", "0.012"], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
    ["start=0", "", ["-t", "0.012"], [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4]],
    ["start=2", "", ["-to", "0.012"], [1, 2, 3, 4, 5, 6, 7, 8, 3, 4]],
    ["start=2", "", ["-frames:a", "4"], [1, 2, 3, 4, 5, 6, 7, 8, 3, 4, 7, 8]],
    ["start=2", ",atrim=end_sample=12", [], [1, 2, 3, 4, 5, 6, 7, 8, 3, 4, 7, 8]],
    ["start=8", "", ["-t", "0.015"], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 9, 10, 9, 10, 9]],
    ["start=-1:time=0.012", "", [], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
    ["start=12", "", [], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
    ["start=2", "", [], null],
    ["start=-1:time=0.002", "", [], null],
  ] as const) {
    it(`bounded infinite aloop ${start}${tail} ${options.join(" ")} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(20);
      for (let i = 0; i < 10; i++) input.writeInt16LE((i + 1) * 1000, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const filter = `asetnsamples=n=3:p=0,aloop=loop=-1:size=4:${start}${tail}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
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
      if (expected === null) {
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("a finite consumer limit is required"), stderr);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
        expected.map(sample => sample * 1000));
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
