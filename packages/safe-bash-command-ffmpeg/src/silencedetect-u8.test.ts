import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 negotiates s16 detection after u8/u8p conversion.
// The fractional threshold truncates to 256, so neither signed run is silent.
for (const { format, signed, noise, select } of [
  { format: "u8", signed: false, noise: "256.25", select: false },
  { format: "u8p", signed: false, noise: "256.25", select: true },
  { format: "u8", signed: false, noise: "256.25", select: true },
  { format: "u8", signed: true, noise: "256.25", select: true },
  { format: "u8", signed: false, noise: "257", select: true }
]) {
  for (const graph of [false, true]) {
    it(`matches native silence events and PCM after ${format} (signed=${signed}, noise=${noise}, select=${select}, graph=${graph})`, async () => {
      const input = encodeWav({ sampleRate: 1000, channels: [
        Float64Array.from([256, 256, 256, 1024, -256, -256, -256, 1024], sample => sample / 32768)
      ] });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      const filter = `aformat=sample_fmts=${format},${signed ? "aformat=sample_fmts=s16," : ""}`
        + `silencedetect=n=${noise}/32767:d=2ms${select ? ",ametadata=select:key=lavfi.silence_start" : ""}`;
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(stderr.trim().split("\n")
        .map(line => line.startsWith("[silencedetect") ? line.slice(line.indexOf("] ") + 2) : line)
        .filter(line => line.includes("silence_")), noise === "257" ? [
          "silence_start: 0", "silence_end: 0.003 | silence_duration: 0.003",
          "silence_start: 0.004", "silence_end: 0.007 | silence_duration: 0.003"
        ] : []);
      assert.equal(Buffer.concat(stdout).toString("hex"), select && noise !== "257"
        ? "" : "000100010001000400ff00ff00ff0004");
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
    });
  }
}
