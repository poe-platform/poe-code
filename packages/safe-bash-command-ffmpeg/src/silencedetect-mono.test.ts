import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const key of ["m", "mono", "positional"]) {
  for (const [value, mono] of [
    ["1", true], ["true", true], ["TRUE", true], ["TrUe", true],
    ["YES", true], ["ON", true], ["y", true], ["Y", true],
    ["0", false], ["false", false], ["n", false], ["N", false],
    ["FALSE", false], ["FaLsE", false], ["NO", false], ["OFF", false],
    ["Perhaps", undefined], ["2", undefined]
  ] as const) {
    it(`silencedetect accepts case-insensitive booleans and rejects invalid ${key}=${value}`, async () => {
      // Seven audible samples precede the reported silence at 8 kHz.
      const input = encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 4000 }, (_, index) => index < 7 ? 0.25 : 0)] });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.wav": "keep" });
      const filter = key === "positional" ? `silencedetect=0.04:0.125:${value}`
        : `silencedetect=n=0.04:d=0.125:${key}=${value}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-y", "-v", "info", "-i", "/in.wav",
          "-af", filter, "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
      if (mono === undefined) {
        assert.equal(result.exitCode, 1, stderr);
        assert.ok(stderr.includes("silencedetect: invalid mono"), stderr);
        assert.equal(volume.readFileSync("/out.wav", "utf8"), "keep");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const prefix = mono ? "channel: 0 | " : "";
        assert.deepEqual(stderr.trim().split("\n").filter(line => line.includes("silence_")), [
          `${prefix}silence_start: 0.000875`,
          `${prefix}silence_end: 0.5 | silence_duration: 0.499125`
        ]);
        assert.deepEqual(parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData,
          parseWav(input).tracks[0]!.decodedAudio!.channelData);
      }
    });
  }
}

// Native FFmpeg 7.0.2: two seconds of mono PCM16 at 8 Hz, with sound from 1 to 1.5 s.
for (const [value, mono] of [
  ["y", true], ["Y", true], ["n", false], ["N", false], ["on", true], ["off", false]
] as const) {
  it(`matches native silence events and raw PCM stdout for m=${value}`, async () => {
    const pcm = Buffer.from("00000000000000000000000000000000401f401f401f401f0000000000000000", "hex");
    const input = Buffer.concat([
      Buffer.from("524946464400000057415645666d742010000000010001000800000010000000020010006461746120000000", "hex"),
      pcm
    ]);
    const volume = Volume.fromJSON({ "/in.wav": input });
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-loglevel", "info", "-i", "/in.wav",
        "-af", `silencedetect=d=0.25:m=${value}`, "-f", "s16le", "-"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const prefix = mono ? "channel: 0 | " : "";
    assert.deepEqual(stderr.trim().split("\n").filter(line => line.includes("silence_")), [
      `${prefix}silence_start: 0`,
      `${prefix}silence_end: 1 | silence_duration: 1`,
      `${prefix}silence_start: 1.5`,
      `${prefix}silence_end: 2 | silence_duration: 0.5`
    ]);
    assert.deepEqual(Buffer.concat(stdout), pcm);
    assert.deepEqual(volume.readFileSync("/in.wav"), input);
  });
}
