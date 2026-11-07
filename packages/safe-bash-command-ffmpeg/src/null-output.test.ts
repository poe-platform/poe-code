import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const format of [undefined, "not_a_muxer", "null", "wav"]) {
    it(`${sync ? "sync" : "async"} validates format ${format ?? "unspecified"} when writing /dev/null`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 800 }, (_, i) => (i - 400) / 32768)] }));
      const args = ["-y", "-v", "error", "-i", "/in.wav",
        ...(format === undefined ? [] : ["-f", format]), "/dev/null"];
      const valid = format === "null" || format === "wav";
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), valid ? "" : undefined);
      } else {
        let stderr = "";
        let stdout = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, valid ? 0 : 1, stderr);
        if (valid) assert.equal(stderr, "");
        else assert.ok(stderr.includes("Unable to find a suitable output format"), stderr);
        assert.equal(stdout, "");
      }
      assert.deepEqual(volume.readdirSync("/"), ["in.wav"]);
    });
  }
}
