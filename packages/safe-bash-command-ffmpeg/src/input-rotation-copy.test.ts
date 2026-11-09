import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const mapped of (sync ? [false] : [false, true])) {
    for (const rotation of [45, -45]) {
      it(`preserves input rotation ${rotation} on ordinary stream copy (mapped=${mapped}, sync=${sync})`, async () => {
        const input = readFileSync(new URL(`./fixtures/rotation-${rotation === 45 ? "45" : "minus-45"}.mp4`, import.meta.url));
        const matrix = [46341, rotation === 45 ? -46341 : 46341, 0,
          rotation === 45 ? 46341 : -46341, 46341, 0, 0, 0, 1073741824];
        assert.deepEqual(parseMp4(input).tracks[0]!.matrix, matrix);
        const volume = Volume.fromJSON({ "/in.mp4": input });
        const args = ["-v", "error", "-y", "-i", "/in.mp4", ...(mapped ? ["-map", "0:v:0"] : []),
          "-c:v", "copy", "/out.mp4"];
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
        const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!;
        assert.deepEqual(output.matrix, matrix);
        assert.deepEqual(output.samples.map(sample => Array.from(sample.data)), parseMp4(input).tracks[0]!.samples.map(sample => Array.from(sample.data)));
      });
    }
  }
}
