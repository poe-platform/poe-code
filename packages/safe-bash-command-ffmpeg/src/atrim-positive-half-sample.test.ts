import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const [sampleRate, length, times] of [
  [1000, 504, [["0.500499", 500], ["0.5005", 501], ["0.500501", 501],
    ["0.4995", 500], ["500500us", 501], ["500.5ms", 501]]],
  [44100, 7720, [["0.174999", 7717], ["0.175", 7718], ["0.175001", 7718],
    ["175000us", 7718], [String.raw`'00\:00\:00.175'`, 7718]]]
] as const) {
  for (const graph of [false, true]) {
    for (const [time, boundary] of times) {
      for (const option of ["start", "end", "duration"]) {
        it(`atrim ${option}=${time} rounds sample boundaries at ${sampleRate} Hz (${graph ? "graph" : "simple"})`, async () => {
          const input = encodeWav({ sampleRate,
            channels: [Float64Array.from({ length }, (_, i) => (i + 1) / 32768)] });
          const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
          let stderr = "";
          const filter = `atrim=${option}=${time}`;
          const result = await createFfmpegCommand().execute({
            args: ["-v", "error", "-i", "/in.wav",
              ...(graph ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
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
          const start = option === "start" ? boundary : 0;
          const end = option === "start" ? length : boundary;
          assert.equal(output.length, (end - start) * 2);
          assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)),
            Array.from({ length: end - start }, (_, i) => start + i + 1));
        });
      }
    }
  }
}
