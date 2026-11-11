import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: nine PCM16 samples at 8 kHz, with tone at samples 0 and 5.
const input = Buffer.from("004000000000000000000040000000000000", "hex");

for (const [pts, boundaries, durations] of [
  ["PTS", ["0.000125", "0.000625", "0.00075", "0.001125"], ["0.0005", "0.000375"]],
  ["PTS+8000000", ["1000.000125", "1000.000625", "1000.00075", "1000.001125"], ["0.0005", "0.000375"]],
  ["PTS-8000000", ["-999.999875", "-999.999375", "-999.99925", "-999.998875"], ["0.0005", "0.000375"]],
  ["1000000*PTS", ["0.000125", "375.00025", "750", "750.000375"], ["375.000125", "0.000375"]]
] as const) {
  for (const graph of [false, true]) {
    for (const mono of [false, true]) {
      it(`preserves sample-resolved silence logs and metadata (${pts}, graph=${graph}, mono=${mono})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = `asetnsamples=n=3:p=0,asetpts=${pts},silencedetect=n=0.1:d=0.00025:m=${Number(mono)},ametadata=mode=print:file=/tags.txt`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(volume.readFileSync("/out.raw"), input);
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
        const prefix = mono ? "channel: 0 | " : "";
        assert.deepEqual(stderr.trim().split("\n").map(line => line.startsWith("[silencedetect") ? line.slice(line.indexOf("] ") + 2) : line).filter(line => line.includes("silence_")), [
          `silence_start: ${boundaries[0]}`,
          `silence_end: ${boundaries[1]} | silence_duration: ${durations[0]}`,
          `silence_start: ${boundaries[2]}`,
          `silence_end: ${boundaries[3]} | silence_duration: ${durations[1]}`
        ].map(line => prefix + line));
        const suffix = mono ? ".1" : "";
        assert.deepEqual(volume.readFileSync("/tags.txt", "utf8").toString().trim().split("\n")
          .filter(line => line.startsWith("lavfi.")), [
          `lavfi.silence_start${suffix}=${boundaries[0]}`,
          `lavfi.silence_end${suffix}=${boundaries[1]}`,
          `lavfi.silence_duration${suffix}=${durations[0]}`,
          `lavfi.silence_start${suffix}=${boundaries[2]}`
        ]);
      });
    }
  }
}
