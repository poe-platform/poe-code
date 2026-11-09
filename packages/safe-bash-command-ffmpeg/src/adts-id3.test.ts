import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseId3 } from "@poe-code/audio-ast";
import { aacAst, parseMp4, serializeAacAdts } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2: ffmpeg -i adts-id3.m4a -c:a copy -write_id3v2 1 adts-id3.aac.
const input = readFileSync(new URL("./fixtures/adts-id3.m4a", import.meta.url));
const native = readFileSync(new URL("./fixtures/adts-id3.aac", import.meta.url));
const nativeTag = parseId3(native);
const packets = native.subarray(nativeTag.size);

for (const sync of [false, true]) {
  for (const write of [undefined, "0", "1", "bad"]) {
    for (const metadata of [[], ["-metadata", "title=Updated"], ["-map_metadata", "-1"]]) {
      it(`ADTS ID3 sync=${sync} write=${write} metadata=${metadata.join(" ")}`, async () => {
        const volume = Volume.fromJSON({ "/in.m4a": input, "/out.aac": "keep" });
        const args = ["-v", "error", "-y", "-i", "/in.m4a", "-c:a", "copy", ...metadata,
          ...(write === undefined ? [] : ["-write_id3v2", write]), "/out.aac"];
        if (sync) {
          const result = evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
          assert.equal(result === "", write !== "bad", result);
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
          assert.equal(result.exitCode, write === "bad" ? 1 : 0, stderr);
        }
        const output = volume.readFileSync("/out.aac") as Buffer;
        if (write === "bad") { assert.equal(output.toString(), "keep"); return; }
        if (write !== "1") { assert.deepEqual(output, packets); return; }
        assert.equal(output.toString("ascii", 0, 3), "ID3");
        const tag = parseId3(output);
        assert.equal(tag.version, 4);
        if (metadata[0] === "-map_metadata") {
          assert.equal(tag.tags.title, undefined);
          assert.equal(tag.tags.artist, undefined);
        } else {
          assert.equal(tag.tags.title, metadata.length ? "Updated" : nativeTag.tags.title);
          assert.equal(tag.tags.artist, nativeTag.tags.artist);
        }
        assert.deepEqual(output.subarray(tag.size), packets);
      });
    }
  }
}

it("ADTS serialization uses explicit metadata and keeps ID3 disabled by default", () => {
  const doc = parseMp4(input);
  for (const serialize of [serializeAacAdts, aacAst().serialize]) {
    assert.deepEqual(Buffer.from(serialize(doc)), packets);
    assert.deepEqual(Buffer.from(serialize(doc, { writeId3v2: false })), packets);
    const output = serialize(doc, { writeId3v2: true, metadata: { title: "Meeting", artist: "Alice" } });
    const tag = parseId3(output);
    assert.equal(tag.version, 4);
    assert.deepEqual(tag.tags, { title: "Meeting", artist: "Alice" });
    assert.deepEqual(Buffer.from(output.subarray(tag.size)), packets);
  }
});
