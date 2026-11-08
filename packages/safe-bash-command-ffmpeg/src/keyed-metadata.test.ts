import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { Volume } from "memfs";
import { parseMp4, probeMp4, probeMp4MetadataSource } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg AAC fixture generated with -movflags +use_metadata_tags,
// -metadata session_id=abc123 -metadata title=Meeting.
const native = readFileSync(new URL("../../mp4-ast/src/fixtures/keyed.m4a", import.meta.url));
for (const sync of [false, true]) {
  for (const [options, expected] of [
    [[], "Meeting"], [["-metadata", "title=Updated"], "Updated"],
    [["-map_metadata", "-1", "-metadata", "title=Updated"], "Updated"],
    [["-map_metadata", "-1"], undefined], [["-metadata", "title="], undefined]
  ] as const) {
    it(`copies M4A title metadata ${JSON.stringify(options)} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.m4a": native });
      const args = ["-y", "-v", "error", "-i", "/in.m4a", "-c", "copy", ...options, "/out.m4a"];
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
      const bytes = volume.readFileSync("/out.m4a") as Buffer;
      assert.equal(probeMp4(bytes).format.tags?.title, expected);
      const source = await probeMp4MetadataSource({ size: bytes.length,
        async read(offset, length) { return bytes.subarray(offset, offset + length); }
      }, 0);
      let title = source.tags.title;
      if (typeof title === "object") {
        let text = "";
        for await (const chunk of title.chunks()) text += chunk;
        title = text;
      }
      assert.equal(title, expected);
      assert.equal(probeMp4(bytes).format.tags?.session_id, undefined);
      assert.deepEqual(parseMp4(bytes).tracks[0]!.samples.map(sample => sample.data),
        parseMp4(native).tracks[0]!.samples.map(sample => sample.data));
    });
  }
}
