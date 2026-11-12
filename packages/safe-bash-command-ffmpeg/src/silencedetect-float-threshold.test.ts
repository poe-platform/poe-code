import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 rounds the threshold to the detector's sample format.
for (const [format, noise, select, silent] of [
  ["flt", "0.1250000001", false, false],
  ["fltp", "0.1250000001", true, false],
  ["flt", "0.1250000001", true, false],
  ["flt", "0.12500002", true, true],
  ["dbl", "0.1250000001", true, true]
] as const) {
  it(`matches native silence events and PCM for ${format}, n=${noise}, select=${select}`, async () => {
    const input = encodeWav({ sampleRate: 1000,
      channels: [Float64Array.from([4096, 4096, 4096, 4096, 8192, 8192], value => value / 32768)] });
    const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
    const chunks: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-nostats", "-v", "info", "-i", "/in.wav", "-af",
        `aformat=sample_fmts=${format},silencedetect=n=${noise}:d=2ms${select ? ",ametadata=select:key=lavfi.silence_start" : ""}`,
        "-f", "s16le", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(Buffer.concat(chunks).toString("hex"), select && !silent ? "" : "001000100010001000200020");
    assert.deepEqual(stderr.trim().split("\n")
      .map(line => line.startsWith("[silencedetect") ? line.slice(line.indexOf("] ") + 2) : line)
      .filter(line => line.includes("silence_")), silent ? [
        "silence_start: 0", "silence_end: 0.004 | silence_duration: 0.004"
      ] : []);
  });
}
