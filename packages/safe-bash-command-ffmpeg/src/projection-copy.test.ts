import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const name of ["flat", "sphere", "tilted", "cube"]) {
  for (const sync of [false, true]) {
    for (const extension of ["mkv", "webm"]) {
      it(`${sync ? "sync" : "async"} ${extension} copy preserves ${name} projection and packets`, async () => {
        const input = readFileSync(new URL(`../../mp4-ast/src/fixtures/projection-${name}.mkv`, import.meta.url));
        const source = parseMkv(new Uint8Array(input));
        const projection = source.tracks[0]!.codecDescriptions[0]!.rawMkvProjectionBytes;
        assert.equal(projection !== undefined, name !== "flat");
        const volume = Volume.fromJSON({ "/in.mkv": input });
        const args = ["-v", "error", "-y", "-i", "/in.mkv", ...(sync ? [] : ["-map", "0:v:0"]), "-c", "copy", `/out.${extension}`];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
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
        const copied = parseMkv(new Uint8Array(volume.readFileSync(`/out.${extension}`) as Buffer));
        assert.deepEqual(copied.tracks[0]!.codecDescriptions[0]!.rawMkvProjectionBytes, projection);
        assert.deepEqual(copied.tracks[0]!.samples.map(sample => sample.data),
          source.tracks[0]!.samples.map(sample => sample.data));
      });
    }
  }
}
