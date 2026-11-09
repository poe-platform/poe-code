import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { IDENTITY_MATRIX, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const fragmented of [false, true]) {
    for (const override of [false, true]) {
      for (const file of ["movie-rotation.mp4", "movie-rotation-cancel.mp4"]) {
        it(`copies the effective movie transform (${file}, sync=${sync}, fragmented=${fragmented}, override=${override})`, async () => {
          const input = readFileSync(new URL(`../../mp4-ast/src/fixtures/${file}`, import.meta.url));
          const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
          const args = ["-y", "-v", "error", ...(override ? ["-display_rotation", "0"] : []), "-i", "/in.mp4", ...(sync ? [] : ["-map", "0:v:0"]), "-c:v", "copy",
            ...(fragmented ? ["-movflags", "frag_keyframe+empty_moov"] : []), "/out.mp4"];
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
          const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer);
          assert.deepEqual(output.tracks[0]!.matrix, override || file.includes("cancel") ? IDENTITY_MATRIX
            : [0, -65536, 0, 65536, 0, 0, 0, 0, 1073741824]);
          assert.deepEqual(output.tracks[0]!.samples.map(sample => sample.data), parseMp4(input).tracks[0]!.samples.map(sample => sample.data));
        });
      }
    }
  }
}
