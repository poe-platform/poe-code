import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { Volume } from "memfs";
import { parseMp4, probeMp4, parseMp4Boxes } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const native = readFileSync(new URL("../../mp4-ast/src/fixtures/aac-external.mp4", import.meta.url));
for (const sync of [false, true]) {
  for (const [options, expected] of [
    [["-movflags", "+use_metadata_tags"], "xyz"],
    [["-movflags", "+faststart+use_metadata_tags"], "xyz"],
    [["-movflags", "+use_metadata_tags", "-movflags", "-use_metadata_tags"], undefined],
    [["-movflags", "+use_metadata_tags", "-movflags", "faststart"], undefined],
    [[], undefined]
  ] as const) {
    it(`writes named M4A metadata ${JSON.stringify(options)} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.m4a": native });
      const args = ["-y", "-v", "error", "-i", "/in.m4a", "-c", "copy", ...options, "-metadata", "session_id=xyz", "-metadata", "title=Known", "/out.m4a"];
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
      assert.equal(probeMp4(bytes).format.tags?.title, "Known");
      assert.equal(probeMp4(bytes).format.tags?.session_id, expected);
      const moov = parseMp4Boxes(bytes).find(box => box.type === "moov");
      const meta = moov?.children?.find(box => box.type === "udta")?.children?.find(box => box.type === "meta");
      assert.equal(meta?.children?.some(box => box.type === "keys"), expected !== undefined);
      assert.deepEqual(parseMp4(bytes).tracks[0]!.samples.map(sample => sample.data),
        parseMp4(native).tracks[0]!.samples.map(sample => sample.data));
    });
  }
}
