import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, serializeSubtitleDocument } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  it(`${sync ? "sync" : "async"} encodes SubRip emphasis into MP4 style packets with exact timing`, async () => {
    const input = Buffer.from("1\n00:00:00,500 --> 00:00:01,250\nHello <i>World</i>\n\n2\n00:00:02,000 --> 00:00:03,000\nSecond line\n");
    const volume = Volume.fromJSON({ "/in.srt": input });
    const args = ["-v", "error", "-y", "-i", "/in.srt", ...(sync ? [] : ["-map", "0:s"]), "-c:s", "mov_text", "/out.mp4"];
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
    const after = parseMp4(output, { decodeSubtitles: false }).tracks[0]!;
    assert.deepEqual(after.samples.map(s => [s.pts / after.timescale, s.duration / after.timescale]),
      [[0, 0.5], [0.5, 0.75], [1.25, 0.75], [2, 1], [3, 0]]);
    assert.deepEqual(after.samples.map(s => Buffer.from(s.data).toString("hex")), [
      "0000",
      "000b48656c6c6f20576f726c64000000167374796c00010006000b00010210ffffffff",
      "0000",
      "000b5365636f6e64206c696e65",
      "0000"
    ]);
    assert.equal(new TextDecoder().decode(serializeSubtitleDocument(parseMp4(output), "srt")),
      "1\n00:00:00,500 --> 00:00:01,250\nHello <i>World</i>\n\n2\n00:00:02,000 --> 00:00:03,000\nSecond line\n\n");
  });
}
