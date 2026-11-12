import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: constant channels report negative zero, but Overall is positive zero.
for (const [name, samples, entropy, overall, pcm] of [
  ["silence", [0, 0, 0, 0], "-0.000000", "0.000000", "0000000000000000"],
  ["constant PCM", [1234, 1234, 1234, 1234], "-0.000000", "0.000000", "d204d204d204d204"],
  ["mixed PCM", [0, 0, 1234, 1234], "0.076923", "0.076923", "00000000d204d204"]
] as const) {
  for (const level of ["info", "error"]) {
    it(`matches native astats entropy and preserves ${name} at ${level} level`, async () => {
      const volume = Volume.fromJSON({
        "/in.wav": Buffer.from(encodeWav({
          sampleRate: 8000,
          channels: [Float64Array.from(samples, sample => sample / 32768)]
        }))
      });
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", level, "-guess_layout_max", "0", "-i", "/in.wav", "-af",
          "astats=measure_perchannel=Entropy:measure_overall=Entropy",
          "-f", level === "info" ? "null" : "s16le", "-"],
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
      assert.equal(Buffer.concat(stdout).toString("hex"), level === "info" ? "" : pcm);
      assert.equal(stderr, level === "info"
        ? `Channel: 1\nEntropy: ${entropy}\nOverall\nEntropy: ${overall}\n`
        : "");
    });
  }
}
