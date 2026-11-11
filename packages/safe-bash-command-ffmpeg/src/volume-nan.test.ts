import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const samples = [-32768, -30001, -20001, -5, -3, -1, 0, 1, 3, 5, 20001, 30001, 32767];
for (const expression of ["0/0", "nan"]) {
  for (const evaluation of ["", ":eval=once", ":eval=frame"]) {
    it(`handles volume=${expression}${evaluation} like native FFmpeg`, async () => {
      const fs = Volume.fromJSON({ "/out.wav": "keep" });
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from(samples, value => value / 32768)] }));
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", "-af", `volume=${expression}${evaluation}`, "-c:a", "pcm_s16le", "/out.wav"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(p: string) { return fs.readFileSync(p); }, async writeFile(p: string, b: Uint8Array) { fs.writeFileSync(p, b); }, async stat(p: string) { return fs.statSync(p); } },
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write(b: Uint8Array) { errors.push(b); } }
      } as never);
      if (evaluation !== ":eval=frame") {
        assert.equal(result.exitCode, 234);
        assert.equal(fs.readFileSync("/out.wav", "utf8"), "keep");
        return;
      }
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      const actual = parseWav(fs.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
      assert.deepEqual(Array.from(actual), samples.map(() => 0));
    });
  }
}
