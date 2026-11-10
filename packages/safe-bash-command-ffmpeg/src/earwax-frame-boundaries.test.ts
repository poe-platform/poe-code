import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, stereo PCM16 at 48 kHz, 6144 input samples.
const expected = [
  [14988, "8bf4a4ef1be054066e03e60a749678847ba05c3f924db96064b482762b27634a"],
  [7528, "fd02661abed1bac78f17f543a2e3d0b1746aec74549ffc3111d20d042d01e05c"],
  [64, "46e8f7403af30d5e2d6751f17cbac8a120eb6b3056bb4c5e150fbe1c7a970555"],
  [22580, "729ed6eccb1ba5dea936bc36ff270d03d1c770fc440a77d29d9b7cef18d58027"]
] as const;

for (const complex of [false, true]) {
  for (const explicit of [false, true]) {
    it(`earwax preserves resampler frames (${complex ? "graph" : "simple"}, ${explicit ? "explicit" : "implicit"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({
        sampleRate: 48000,
        channels: [0, 1].map(channel => Float64Array.from({ length: 6144 }, (_, frame) =>
          ((frame * 421 + channel * 1709) % 12000 - 6000) / 32768))
      }));
      for (const [frame, [length, hash]] of expected.entries()) {
        volume.writeFileSync("/out.raw", "KEEP");
        const filter = `${explicit ? "aresample=44100," : ""}earwax${frame < 3 ? `,aselect=eq(n\\,${frame})` : ""}`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav", ...(complex
            ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, length, `frame ${frame}`);
        assert.equal(createHash("sha256").update(output).digest("hex"), hash, `frame ${frame}`);
      }
    });
  }
}
