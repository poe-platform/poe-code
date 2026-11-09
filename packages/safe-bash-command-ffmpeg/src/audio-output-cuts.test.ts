import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const cases = [
  { input: [], output: [], start: 7999, end: 0 },
  { input: [], output: ["-ss", "0.25", "-t", "0.25"], start: 5999, end: 4000 },
  { input: [], output: ["-ss", "0.25"], start: 5999, end: 0 },
  { input: [], output: ["-t", "0.25"], start: 7999, end: 6000 },
  { input: [], output: ["-to", "0.5"], start: 7999, end: 4000 },
  { input: [], output: ["-ss", "0.25", "-to", "0.5"], start: 5999, end: 4000 },
  { input: ["-ss", "0.25"], output: ["-t", "0.25"], start: 7999, end: 6000 },
  { input: ["-ss", "0.25"], output: [], start: 7999, end: 2000 },
  { input: ["-t", "0.25"], output: [], start: 1999, end: 0 }
];
for (const graph of [false, true]) {
  for (const { input, output, start, end } of cases) {
    for (const filter of ["areverse", "anull"]) {
      it(`applies input ${input.join(" ")} and output ${output.join(" ")} cuts around ${filter} (graph=${graph})`, async () => {
        const volume = Volume.fromJSON({ "/out.raw": "keep" });
        volume.writeFileSync("/ramp.wav", encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length: 8000 }, (_, i) => i / 32768)] }));
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", ...input, "-i", "/ramp.wav",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            ...output, "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
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
        const bytes = volume.readFileSync("/out.raw") as Buffer;
        const actual = Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2));
        const first = (input[0] === "-ss" ? 2000 : 0) + (output[0] === "-ss" ? 2000 : 0);
        const expected = Array.from({ length: start - end + 1 }, (_, i) => filter === "areverse" ? start - i : first + i);
        assert.deepEqual(actual, expected);
      });
    }
  }
}
