import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, serializeSubtitleDocument } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  it(`${sync ? "sync" : "async"} MP4 subtitle stream copy preserves styled packets and timing`, async () => {
    const input = readFileSync(new URL("../../mp4-ast/src/fixtures/timed-text-styles.mp4", import.meta.url));
    const volume = Volume.fromJSON({ "/in.mp4": input });
    const args = ["-v", "error", "-y", "-i", "/in.mp4", ...(sync ? [] : ["-map", "0:s"]), "-c:s", "copy", "/out.mp4"];
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
    const output = volume.readFileSync("/out.mp4") as Buffer;
    const before = parseMp4(input, { decodeSubtitles: false }).tracks[0]!;
    const after = parseMp4(output, { decodeSubtitles: false }).tracks[0]!;
    assert.equal(after.timescale, before.timescale);
    assert.deepEqual(after.samples.map(({ data, pts, dts, duration, size }) => ({ data, pts, dts, duration, size })),
      before.samples.map(({ data, pts, dts, duration, size }) => ({ data, pts, dts, duration, size })));
    assert.equal(new TextDecoder().decode(serializeSubtitleDocument(parseMp4(output), "srt")),
      "1\n00:00:00,250 --> 00:00:01,125\nPlain <i>slant</i> <b>bold</b>\nNext line\n\n");
  });
}
