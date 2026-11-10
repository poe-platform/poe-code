import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const format of ["a_not_real_format", "mp3", "wav", undefined]) {
    it(`${sync ? "sync" : "async"} input format ${format ?? "probing"}`, async () => {
      const volume = Volume.fromJSON({});
      const samples = Float64Array.from({ length: 800 }, (_, i) => (i - 400) / 32768);
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [samples] }));
      const args = ["-v", "error", "-y", ...(format === undefined ? [] : ["-f", format]), "-i", "/in.wav", "/out.wav"];
      const valid = format === undefined || format === "wav";
      if (sync) {
        const result = evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        assert.equal(result, valid ? "" : undefined);
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, valid ? 0 : format === "a_not_real_format" ? 234 : 1, stderr);
        if (format === "a_not_real_format") assert.ok(stderr.includes("Unknown input format"), stderr);
      }
      assert.equal(volume.existsSync("/out.wav"), valid);
      if (valid) {
        const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
        assert.equal(audio.sampleRate, 8000);
        assert.equal(audio.channels, 1);
        assert.deepEqual(Array.from(audio.channelData[0]!), Array.from(samples));
      }
    });
  }
}
