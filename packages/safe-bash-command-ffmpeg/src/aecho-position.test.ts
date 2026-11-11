import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: source frames retain pos; only drained echo frames lack it.
for (const complex of [false, true]) {
  for (const prefix of ["", "asetnsamples=n=4:p=0,"]) {
    for (const [selection, expected] of [
      [",aselect=isnan(pos)", [0, 0, 150, 0, 0]],
      [",aselect=not(isnan(pos))", [560, 0, 248, -1121, 0, 0, 0, 0, -823, 0, 75]],
      ["", [560, 0, 248, -1121, 0, 0, 0, 0, -823, 0, 75, 0, 0, 150, 0, 0]]
    ] as const) {
      const filter = `${prefix}aecho=0.7:0.8:2|5:0.31|0.62${selection}`;
      it(`${filter} preserves source positions (${complex ? "complex" : "simple"})`, async () => {
        const samples = [1001, 0, 0, -2003, 0, 0, 0, 0, 303, 0, 0];
        const input = Buffer.alloc(samples.length * 2);
        samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
        const volume = Volume.fromJSON({ "/in.raw": input });
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ac", "1", "-ar", "1000", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, index) => output.readInt16LE(index * 2)), expected);
      });
    }
  }
}
