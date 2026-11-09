import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseAvi, parseMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  it(`${sync ? "sync" : "async"} stream copy preserves VP9 through WebM and AVI`, async () => {
    const input = readFileSync(new URL("../../mp4-ast/src/fixtures/avi-vp9.webm", import.meta.url));
    const expected = parseMkv(new Uint8Array(input)).tracks[0]!;
    const volume = Volume.fromJSON({ "/source.webm": input });
    for (const [source, output] of [["/source.webm", "/out.avi"], ["/out.avi", "/back.webm"]] as const) {
      const args = ["-v", "error", "-i", source, ...(sync ? [] : ["-map", "0:v:0"]), "-c", "copy", output];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? new Uint8Array(volume.readFileSync(path) as Buffer) : undefined,
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
      const bytes = new Uint8Array(volume.readFileSync(output) as Buffer);
      const actual = (output.endsWith(".avi") ? parseAvi(bytes) : parseMkv(bytes)).tracks[0]!;
      assert.equal(actual.codecDescriptions[0]!.codecName, "vp9");
      assert.equal(actual.samples.length, 36);
      assert.deepEqual(actual.samples.map(sample => sample.data), expected.samples.map(sample => sample.data));
    }
  });
}
