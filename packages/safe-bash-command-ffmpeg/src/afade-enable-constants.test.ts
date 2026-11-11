import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: eight mono PCM16 samples of 16000 at 8 kHz.
const input = new Array<number>(8).fill(16000);
const faded = [0, 4000, 8000, 12000, 16000, 16000, 16000, 16000];
for (const [expression, enabled] of [
  ["PI", true], ["E-2", true], ["PHI-1", true],
  ["PI/10", false], ["E-3", false], ["PHI-2", false],
  ["inf", true], ["-Infinity", true], ["iNf", true],
  ["nan", false], ["NaN", false],
  ["isinf(inf)", true], ["isnan(nan)", true],
  ["1", true], ["1/0", true], ["0", false], ["0/0", false],
  ["pi", null], ["unknown", null]
] as const) {
  for (const graph of [false, true]) {
    for (const scheduled of [false, true]) {
      it(`afade enable=${expression} matches native PCM (${scheduled ? "scheduled" : "initial"}, ${graph ? "graph" : "simple"})`, async () => {
        const fs = Volume.fromJSON({ "/out.pcm": "KEEP" });
        fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from(input, sample => sample / 32768)] }));
        const initial = enabled ? input : faded;
        const filter = "asetnsamples=n=2:p=0," + (scheduled
          ? `asendcmd=c='0.00025 afade@x enable ${expression}',afade@x=ns=4:enable=${enabled ? 0 : 1}`
          : `afade=ns=4:enable='${expression}'`);
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
            : ["-af", filter]), "-f", "s16le", "/out.pcm"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        if (enabled === null && !scheduled) {
          assert.equal(result.exitCode, 1, stderr);
          assert.ok(stderr.includes("afade enable: invalid or unsupported expression"), stderr);
          assert.equal(fs.readFileSync("/out.pcm", "utf8"), "KEEP");
        } else {
          assert.equal(result.exitCode, 0, stderr);
          const expected = enabled === null ? initial : enabled ? faded : input;
          const output = fs.readFileSync("/out.pcm") as Buffer;
          assert.equal(output.length, 16);
          assert.deepEqual(Array.from({ length: 8 }, (_, index) => output.readInt16LE(index * 2)),
            scheduled ? [...initial.slice(0, 2), ...expected.slice(2)] : expected);
        }
      });
    }
  }
}
