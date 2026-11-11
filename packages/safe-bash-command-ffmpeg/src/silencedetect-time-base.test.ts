import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg rescales sample offsets to the filter time base, with ties away from zero.
// The trailing silence ends at EOF and is logged without adding frame metadata.
const input = Buffer.from("004000000000000000000040000000000000", "hex");
for (const [timing, duration, events, tags] of [
  ["asetnsamples=n=3:p=0,asettb=1/1000", "0.00025",
    ["0", "0", "0", "0.001", "0.001", "0"], ["0", "0", "0", "0.001"]],
  ["asetnsamples=n=3:p=0", "0.00025",
    ["0.000125", "0.000625", "0.0005", "0.00075", "0.001125", "0.000375"],
    ["0.000125", "0.000625", "0.0005", "0.00075"]],
  ["asetnsamples=n=3:p=0,asettb=1/16000", "0.00025",
    ["0.000125", "0.000625", "0.0005", "0.00075", "0.001125", "0.000375"],
    ["0.000125", "0.000625", "0.0005", "0.00075"]],
  ["asetnsamples=n=2:p=0,asettb=1/4000", "0.000375",
    ["0", "0.00075", "0.00075", "0.00075", "0.00125", "0.0005"],
    ["0", "0.00075", "0.00075", "0.00075"]]
] as const) {
  for (const graph of [false, true]) {
    for (const mono of [false, true]) {
      it(`silencedetect uses negotiated ticks (${timing}, graph=${graph}, mono=${mono})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = `${timing},silencedetect=n=0.1:d=${duration}:m=${Number(mono)},ametadata=mode=print:file=/tags.txt`;
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
        const suffix = mono ? ".1" : "";
        assert.deepEqual(volume.readFileSync("/tags.txt", "utf8").toString().split("\n").filter(line => line.startsWith("lavfi.")),
          [`lavfi.silence_start${suffix}=${tags[0]}`, `lavfi.silence_end${suffix}=${tags[1]}`,
            `lavfi.silence_duration${suffix}=${tags[2]}`, `lavfi.silence_start${suffix}=${tags[3]}`]);
        const prefix = mono ? "channel: 0 | " : "";
        assert.deepEqual(stderr.trim().split("\n").filter(line => line.includes("silence_")), [
          `silence_start: ${events[0]}`, `silence_end: ${events[1]} | silence_duration: ${events[2]}`,
          `silence_start: ${events[3]}`, `silence_end: ${events[4]} | silence_duration: ${events[5]}`
        ].map(line => prefix + line));
      });
    }
  }
}
