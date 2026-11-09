import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { readFileSync } from "node:fs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg AMR inputs and matching 3GP stream copies.
for (const mode of ["nb", "wb"]) {
  const input = readFileSync(new URL(`../../mp4-ast/src/fixtures/amr-copy-${mode}.amr`, import.meta.url));
  const reference = readFileSync(new URL(`../../mp4-ast/src/fixtures/amr-copy-${mode}.3gp`, import.meta.url));
  for (const [explicit, truncated] of [[false, false], [true, false], [false, true]]) {
    it(`copies standalone AMR-${mode} packets to 3GP (explicit: ${explicit}, truncated: ${truncated})`, async () => {
      const volume = Volume.fromJSON({ "/input": input.subarray(0, truncated ? -1 : undefined), "/output.3gp": "KEEP" });
      const args = ["-y", "-v", "error", ...(explicit ? ["-f", "amr"] : []), "-i", "/input", "-c:a", "copy", "/output.3gp"];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args,
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); } },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      const asyncOutput = volume.readFileSync("/output.3gp");
      volume.writeFileSync("/output.3gp", "KEEP");
      assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), truncated ? undefined : "");
      assert.deepEqual(volume.readFileSync("/output.3gp"), asyncOutput);
      if (truncated) {
        assert.notEqual(result.exitCode, 0);
        assert.match(stderr, /Truncated AMR frame/);
        assert.equal(volume.readFileSync("/output.3gp", "utf8"), "KEEP");
        return;
      }
      assert.equal(result.exitCode, 0, stderr);
      const actual = parseMp4(volume.readFileSync("/output.3gp") as Buffer, { decodeAudio: false }).tracks[0]!;
      const expected = parseMp4(reference, { decodeAudio: false }).tracks[0]!;
      assert.equal(actual.codecDescriptions[0]!.formatFourCC, expected.codecDescriptions[0]!.formatFourCC);
      assert.equal(actual.codecDescriptions[0]!.sampleRate, expected.codecDescriptions[0]!.sampleRate);
      assert.equal(actual.samples.length, mode === "nb" ? 7 : 6);
      assert.deepEqual(actual.samples.map(s => Buffer.from(s.data!)), expected.samples.map(s => Buffer.from(s.data!)));
      assert.deepEqual(actual.samples.map(s => s.duration / actual.timescale), expected.samples.map(s => s.duration / expected.timescale));
    });
  }
}
