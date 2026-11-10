import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  for (const filter of ["earwax", "earwax=", "earwax@stage", "earwax@stage=",
    "earwax=unknown=1", "earwax@stage=unknown=1"]) {
    it(`earwax ${complex ? "graph" : "simple"}: ${filter} handles empty options`, async () => {
      const input = encodeWav({
        sampleRate: 44100,
        channels: [0, 1].map(channel => Float64Array.from({ length: 1536 }, (_, frame) =>
          ((frame * 421 + channel * 1709) % 12000 - 6000) / 32768))
      });
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.wav", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav", ...(complex
          ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
        "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (filter.includes("unknown")) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, 6144);
        // Native FFmpeg 7.0.2 PCM16 output for the same deterministic stereo input.
        assert.equal(createHash("sha256").update(output).digest("hex"),
          "1939dc79f772a387d5f452053f73d6c263ee685c9cd20ac2e066b06878ac916c");
      }
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
    });
  }
}
