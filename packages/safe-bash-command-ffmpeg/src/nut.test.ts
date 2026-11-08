import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const fixture of ["tone", "s64le", "s64be"]) {
  for (const sync of [false, true]) {
    it(`reads native NUT ${fixture} (${sync ? "sync" : "async"})`, async () => {
      const input = readFileSync(new URL(`../../mp4-ast/src/fixtures/${fixture}.nut`, import.meta.url));
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.nut", input);
      const args = ["-v", "error", "-y", "-i", "/in.nut", ...(fixture === "tone" ? ["-c", "copy"] : []),
        "-f", fixture === "tone" ? "wav" : "s32le", "/out.bin"];
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
      const pcm = fixture === "tone" ? output.subarray(output.indexOf("data") + 8) : output;
      assert.equal(createHash("sha256").update(pcm).digest("hex"), fixture === "tone"
        ? "dbef1ad0b2fb90abb92578e632646843bc796414aff5b64ed66dc27757fa45ee"
        : "ea7e16c18f09210d2dcdc5c97db7f56d7d534bb1ae3ea5a98a3f2d9f1f7ad1f2");
    });
  }
}
