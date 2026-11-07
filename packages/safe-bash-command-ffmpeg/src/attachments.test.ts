import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv, serializeMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const data = new TextEncoder().encode("speaker notes\0\xff");
const attachment = { data, size: data.length, tags: { filename: "guide.txt", mimetype: "text/plain", title: "Speaker notes" } };
const source = parseMkv(readFileSync(new URL("../../mp4-ast/src/fixtures/track-dispositions.mkv", import.meta.url)));
const input = serializeMkv({ ...source, attachments: [attachment] });
const nativeAvailable = spawnSync("ffprobe", ["-version"]).status === 0;

for (const [maps, count, tracks] of [
  [["0"], 1, source.tracks.length],
  [["0:t:0"], 1, 0],
  [["0:a", "1:t:0"], 1, 2],
  [["0", "1:t", "-0:t"], 1, source.tracks.length],
  [["0:a", "0:t:99?"], 0, 2],
  [[`0:${source.tracks.length}`], 1, 0],
  [["0", "-0:t"], 0, source.tracks.length],
  [["0:a"], 0, 2],
  [[], 0, 3],
] as const) {
  it(`copies mapped Matroska attachments: ${maps.join(",") || "automatic"}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.mkv", input);
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.mkv", "-i", "/in.mkv", ...maps.flatMap(map => ["-map", map]), "-c", "copy", "/out.mkv"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const output = volume.readFileSync("/out.mkv") as Buffer;
    const actual = parseMkv(output);
    assert.equal(actual.tracks.length, tracks);
    assert.equal(actual.attachments.length, count);
    if (count) {
      assert.deepEqual(actual.attachments[0]!.tags, attachment.tags);
      assert.deepEqual(Buffer.from(actual.attachments[0]!.data), Buffer.from(data));
    }
    if (nativeAvailable && tracks) {
      const probe = spawnSync("ffprobe", ["-v", "error", "-show_streams", "-show_data", "-of", "json", "pipe:0"], { input: output });
      assert.equal(probe.status, 0, probe.stderr.toString());
      const files = JSON.parse(probe.stdout.toString()).streams.filter((stream: { codec_type: string }) => stream.codec_type === "attachment");
      assert.equal(files.length, count);
      if (count) {
        assert.deepEqual(files[0].tags, attachment.tags);
        assert.equal(files[0].extradata_size, data.length);
        assert.ok(files[0].extradata.includes("7370 6561 6b65 7220 6e6f 7465 7300 c3bf"));
      }
    }
  });
}
