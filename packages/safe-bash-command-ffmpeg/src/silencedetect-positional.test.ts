import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 status, PCM and ordered silence events.
const fullSilence = ["silence_start: 0", "silence_end: 0.008 | silence_duration: 0.008"];
const monoSilence = [
  "channel: 0 | silence_start: 0.001",
  "channel: 0 | silence_end: 0.004 | silence_duration: 0.003",
  "channel: 0 | silence_start: 0.005",
  "channel: 0 | silence_end: 0.008 | silence_duration: 0.003"
];
for (const graph of [false, true]) {
  for (const [options, events] of [
    ["d=2ms:n=0.01:0.5", fullSilence],
    ["d=2ms:n=0.5", fullSilence],
    ["mono=0:n=0.01:d=2ms:1", []],
    ["mono=0:n=0.01:d=1", []],
    ["0.01:2ms:1", monoSilence],
    ["duration=2ms:noise=0.01:0.5", fullSilence],
    ["0.01:mono=0:0.5:2ms", fullSilence],
    ["noise=0.01:2ms:1", monoSilence]
  ] as const) {
    it(`binds silencedetect=${options} in native order (graph=${graph})`, async () => {
      const pcm = Buffer.from("803e00000000000020d1000000000000", "hex");
      const input = Buffer.concat([
        Buffer.from("524946463400000057415645666d74201000000001000100e8030000d0070000020010006461746110000000", "hex"),
        pcm
      ]);
      const volume = Volume.fromJSON({ "/in.wav": input });
      const filter = `silencedetect=${options}`;
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Buffer.concat(stdout), pcm);
      assert.deepEqual(volume.readFileSync("/in.wav"), input);
      assert.deepEqual(stderr.trim().split("\n")
        .map(line => line.startsWith("[silencedetect") ? line.slice(line.indexOf("] ") + 2) : line)
        .filter(line => line.includes("silence_")), events);
    });
  }
}
