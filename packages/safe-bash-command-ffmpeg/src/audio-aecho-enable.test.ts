import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 distinguishes unsupported timelines from unknown options.
for (const [suffix, exitCode] of [[":enable=1", 176], [":bogus=1", 8], ["", 0]] as const) {
  for (const graph of [false, true]) {
    it(`aecho ${suffix || "without extra options"} matches native output (${graph ? "graph" : "simple"})`, async () => {
      const volume = new Volume();
      const input = Buffer.alloc(22);
      [1001, 0, 0, -2003, 0, 0, 0, 0, 303, 0, 0].forEach((sample, index) => input.writeInt16LE(sample, index * 2));
      volume.writeFileSync("/in.raw", input);
      const filter = `aecho=0.7:0.8:2|5:0.31|0.62${suffix}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ac", "1", "-ar", "1000", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, exitCode, stderr);
      assert.equal(volume.existsSync("/out.raw"), exitCode === 0);
      if (exitCode === 0) {
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)),
          [560, 0, 248, -1121, 0, 0, 0, 0, -823, 0, 75, 0, 0, 150, 0, 0]);
      }
    });
  }
}
