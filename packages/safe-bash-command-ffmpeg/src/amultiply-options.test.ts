import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 statuses and complete PCM for a 12-sample 8 kHz ramp.
for (const filter of ["amultiply", "amultiply@mul"]) {
  for (const [options, exitCode, diagnostic] of [
    ["=enable=0", 176, "timeline"],
    ["=enable='between(t,0,1)'", 176, "timeline"],
    ["=foo=1", 8, "option"],
    ["=foo=1:enable=0", 8, "option"],
    ["", 0, ""]
  ] as const) {
    it(`${filter}${options} matches native status and emits no PCM on failure`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 12 }, (_, i) => (i + 1) * 1000 / 32768)] }));
      const output: Uint8Array[] = [];
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.wav", "-filter_complex", `[0:a][0:a]${filter}${options}[o]`,
          "-map", "[o]", "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      const error = Buffer.concat(errors).toString();
      assert.equal(result.exitCode, exitCode, error);
      assert.equal(Buffer.concat(output).toString("hex"),
        exitCode === 0 ? "1f007a001301e801fb024b04d705a107a809ec0b6d0e2b11" : "");
      if (exitCode === 0) assert.equal(error, "");
      else assert.ok(error.includes(diagnostic), error);
    });
  }
}
