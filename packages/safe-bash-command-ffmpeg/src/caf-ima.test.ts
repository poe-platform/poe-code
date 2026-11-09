import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { cafAst, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg stream copy of the first three stereo packets, with its decoded PCM hash.
const cafIma = Buffer.from("Y2FmZgABAABkZXNjAAAAAAAAACBAv0AAAAAAAGltYTQAAAAAAAAARAAAAEAAAAACAAAABGNoYW4AAAAAAAAADABlAAIAAAAAAAAAAGluZm8AAAAAAAAAGQAAAAFlbmNvZGVyAExhdmY2My4xLjEwMQBkYXRhAAAAAAAAANAAAAAAAAAQEREREREREY8AAAAAERERjwAAAAARERGPAAAAABEREQAAdwcICAgICAiAgICAgJAAAAAAAAAAAAAAAAAAAAAAAAAAAI8AAAAAERERjwAAAAARERGPAAAAABEREY8AAAAAERERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAjwAAAAARERGPAAAAABEREY8AAAAAERERjwAAAAAREREAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "base64");
const cafImaPcmHash = "8e6ce49df462c44fff295b42e9841867cf2eb0c72aba83a33b21f37aa00e90ae";

for (const sync of [false, true]) {
  for (const format of ["s16le", "caf", "mov"]) {
    it(`reads IMA4 CAF to ${format} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/out.bin": "keep" });
      volume.writeFileSync("/in.caf", Buffer.from(cafIma));
      const args = ["-v", "error", "-y", "-i", "/in.caf", "-c:a", format === "s16le" ? "pcm_s16le" : "copy", "-f", format, "/out.bin"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
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
        assert.equal(result.exitCode, 0, stderr);
      }
      const output = volume.readFileSync("/out.bin") as Buffer;
      if (format === "s16le") {
        assert.equal(output.length, 768);
        assert.equal(createHash("sha256").update(output).digest("hex"), cafImaPcmHash);
      } else {
        const copied = format === "caf" ? cafAst().parse(output, { decodeAudio: false }) : parseMp4(output);
        const original = cafAst().parse(cafIma, { decodeAudio: false });
        assert.equal(copied.durationSeconds, original.durationSeconds);
        assert.deepEqual(copied.tracks[0]!.samples.map(sample => [sample.duration, Buffer.from(sample.data)]),
          original.tracks[0]!.samples.map(sample => [sample.duration, Buffer.from(sample.data)]));
      }
    });
  }
}
