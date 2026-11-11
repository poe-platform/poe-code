import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 reference samples, at 1 kHz in four-sample frames.
for (const complex of [false, true]) {
  for (const target of ["all", "silenceremove", "silenceremove@trim", "missing"]) {
    for (const scenario of [
      {
        command: "stop_threshold 1",
        options: "stop_periods=-1:stop_threshold=0.06:window=0",
        samples: [0, 0, 0, 5000, 4000, -4000, -5000, 0, 0, 0, 0, 8000, -8000, 9000, -7000, 0, 0, 0, 0, 0, 0, 1000, 0, 0],
        expected: [0, 0, 0, 5000, 4000, -4000, -5000],
        unmatched: [0, 0, 0, 5000, 4000, -4000, -5000, 8000, -8000, 9000, -7000]
      },
      {
        command: "start_threshold 0.001",
        options: "start_periods=1:start_threshold=1:window=0",
        samples: [0, 0, 100, 0, 200, 300, 0, 0, 0, 400, 500, 600, 0, 0, 0, 0, 700, 800, 0, 0],
        expected: [400, 500, 600, 0, 0, 0, 0, 700, 800, 0, 0],
        unmatched: []
      }
    ]) {
      it(`silenceremove ${target} ${scenario.command} (complex=${complex})`, async () => {
        const input = Buffer.alloc(scenario.samples.length * 2);
        scenario.samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
        const volume = Volume.fromJSON({ "/in.pcm": input });
        const filter = `asetnsamples=n=4:p=0,asendcmd=c='0.008 ${target} ${scenario.command}',silenceremove@trim=${scenario.options}`;
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.pcm",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        const output = Buffer.concat(chunks);
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
          target === "missing" ? scenario.unmatched : scenario.expected);
      });
    }
  }
}
