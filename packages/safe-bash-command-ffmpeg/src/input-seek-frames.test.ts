import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg starts fresh WAV packets for input seeks, but filters before output seeks.
for (const seek of [0, 380, 512]) {
  for (const inputSide of [true, false]) {
    for (const expression of [undefined, "n+1", "t"]) {
      it(`preserves WAV filter frames for ${inputSide ? "input" : "output"} seek ${seek}, volume=${expression}`, async () => {
        const fs = Volume.fromJSON({});
        fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [new Float64Array(4000).fill(12000 / 32768)] }));
        const seekArgs = ["-ss", String(seek / 8000)];
        const errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-y", ...(inputSide ? seekArgs : []), "-i", "/in.wav",
            ...(!inputSide ? seekArgs : []), ...(expression ? ["-af", `volume=${expression}:eval=frame`] : []),
            "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(p: string) { return fs.readFileSync(p); },
            async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); },
            async stat(p: string) { return fs.statSync(p); } },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(b: Uint8Array) { errors.push(b); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        const output = fs.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, (4000 - seek) * 2);
        for (let i = 0; i < output.length / 2; i++) {
          const frame = Math.floor((i + (inputSide ? 0 : seek)) / 512);
          const gain = expression === "n+1" ? frame + 1 : expression === "t" ? frame * 512 / 8000 : 1;
          assert.equal(output.readInt16LE(i * 2), Math.min(32767, Math.round(12000 * gain)), `sample ${i}`);
        }
      });
    }
  }
}
