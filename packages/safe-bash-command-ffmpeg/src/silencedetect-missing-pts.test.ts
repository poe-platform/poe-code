import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: two silent intervals, including one flushed at EOF.
const input = Buffer.from("004000000000000000000040000000000000", "hex");
for (const graph of [false, true]) {
  for (const [missing, framed] of [[false, false], [true, false], [true, true]] as const) {
    for (const mono of [false, true]) {
      it(`preserves silence durations with missing PTS=${missing} (mono=${mono}, graph=${graph}, framed=${framed})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = `${framed ? "asetnsamples=n=3:p=0," : ""}${missing ? "asetpts=NAN," : ""}silencedetect=n=0.1:d=0.00025:m=${Number(mono)},ametadata=mode=print`;
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
        const times = missing ? Array<string>(4).fill("-1152921504606847")
          : ["0.000125", "0.000625", "0.00075", "0.001125"];
        const prefix = mono ? "channel: 0 | " : "";
        const lines = stderr.trim().split("\n").map(line => line.startsWith("[silencedetect") ? line.slice(line.indexOf("] ") + 2) : line);
        assert.deepEqual(lines.filter(line => line.startsWith(prefix + "silence_")), [
          `silence_start: ${times[0]}`,
          `silence_end: ${times[1]} | silence_duration: ${framed ? "0.000125" : "0.0005"}`,
          ...(framed ? ["silence_start: NOPTS"] : []),
          `silence_start: ${times[2]}`,
          `silence_end: ${times[3]} | silence_duration: ${framed ? "0.00025" : "0.000375"}`
        ].map(line => prefix + line));
        const suffix = mono ? ".1" : "";
        assert.deepEqual(lines.filter(line => line.startsWith("lavfi.silence_")).sort(), [
          `lavfi.silence_start${suffix}=${times[2]}`,
          `lavfi.silence_end${suffix}=${times[1]}`,
          `lavfi.silence_duration${suffix}=${framed ? "0.000125" : "0.0005"}`,
          ...(framed ? [`lavfi.silence_start${suffix}=${times[0]}`] : [])
        ].sort());
      });
    }
  }
}
