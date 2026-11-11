import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: frame processing follows filter order; EOF flush reverses it.
const input = Buffer.from("004000000000000000000040000000000000", "hex");
const events = [
  "silence_start: 0.000125",
  "silence_end: 0.000625 | silence_duration: 0.0005",
  "silence_start: 0.00075",
  "silence_end: 0.001125 | silence_duration: 0.000375"
];

for (const graph of [false, true]) {
  for (const frameSize of [3, 9]) {
    for (const detectors of [[true], [false], [true, false], [true, false, false]]) {
      it(`orders silence events by frame and flush (${detectors}, frameSize=${frameSize}, graph=${graph})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = `asetnsamples=n=${frameSize}:p=0,` + detectors.map((mono, index) =>
          `silencedetect${graph ? `@detector${index}` : ""}=m=${Number(mono)}:n=0.1:d=0.00025`).join(",");
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
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
        assert.deepEqual(volume.readFileSync("/out.raw"), input);
        const message = (mono: boolean, event: string) => (mono ? "channel: 0 | " : "") + event;
        const frameEvents = events.slice(0, 3);
        const expected = frameSize === 3
          ? frameEvents.flatMap(event => detectors.map(mono => message(mono, event)))
          : detectors.flatMap(mono => frameEvents.map(event => message(mono, event)));
        expected.push(...[...detectors].reverse().map(mono => message(mono, events[3]!)));
        assert.deepEqual(stderr.trim().split("\n").filter(line => line.includes("silence_")), expected);
      });
    }
  }
}
