import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 decodes mono 8 kHz PCM16 WAV in 512-sample frames.
// Output seeking trims filtered frames; input seeking resets the filter clock.
for (const [side, seek] of [["output", 0], ["output", 0.064], ["output", 0.0475], ["input", 0.064]] as const) {
  for (const expression of [undefined, "t", "n+1"]) {
    it(`preserves the filter timeline for ${side} seek ${seek} with volume=${expression ?? "unfiltered"}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(4000).fill(12000 / 32768)] }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", ...(side === "input" ? ["-ss", String(seek)] : []),
          "-i", "/in.wav", ...(side === "output" ? ["-ss", String(seek)] : []),
          ...(expression === undefined ? [] : ["-af", `volume=${expression}:eval=frame`]),
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
      assert.equal(result.exitCode, 0, stderr);
      const bytes = volume.readFileSync("/out.raw") as Buffer;
      const skipped = Math.round(seek * 8000);
      assert.equal(bytes.length, (4000 - skipped) * 2);
      const actual = Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2));
      const expected = Array.from({ length: 4000 - skipped }, (_, i) => {
        const frame = Math.floor((i + (side === "output" ? skipped : 0)) / 512);
        return expression === undefined ? 12000
          : expression === "t" ? frame * 768 : Math.min(32767, (frame + 1) * 12000);
      });
      assert.deepEqual(actual, expected);
    });
  }
}
