import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [name, fieldOrder] of [["normal", "progressive"], ["top", "tt"], ["bottom", "bb"]]) {
    it(`${sync ? "sync" : "async"} stream copy preserves ${fieldOrder} and both VP8 packets`, async () => {
      const bytes = new Uint8Array(readFileSync(new URL(`../../mp4-ast/src/fixtures/vp8-field-${name}.mkv`, import.meta.url)));
      const volume = Volume.fromJSON({ "/input.mkv": Buffer.from(bytes) });
      const args = ["-v", "error", "-y", "-i", "/input.mkv", ...(sync ? [] : ["-map", "0:v:0"]), "-c", "copy", "/output.mkv"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, data) => { volume.writeFileSync(path, data); return true; }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const source = parseMkv(bytes).tracks[0]!;
      const copied = parseMkv(new Uint8Array(volume.readFileSync("/output.mkv") as Buffer)).tracks[0]!;
      assert.equal(copied.codecDescriptions[0]!.fieldOrder, fieldOrder);
      assert.equal(copied.samples.length, 2);
      assert.deepEqual(copied.samples.map(sample => sample.data), source.samples.map(sample => sample.data));
    });
  }
}
