import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { parseMkv } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const native = readFileSync(new URL("../../mp4-ast/src/fixtures/ass-styled.mkv", import.meta.url));
const packet = "0,0,Default,,0,0,0,,Plain {\\i1}slant{\\i0} {\\b1}bold{\\b0}\\NNext line";
for (const sync of [false, true]) {
    for (const copy of [false, true]) {
      it(`${sync ? "sync" : "async"} ${copy ? "copies ASS" : "encodes styled SubRip as ASS"} in Matroska`, async () => {
        const source = copy ? "/in.mkv" : "/in.srt";
        const volume = Volume.fromJSON({ [source]: copy ? native : "1\n00:00:00,250 --> 00:00:01,125\nPlain <i>slant</i> <b>bold</b>\nNext line\n" });
        const read = (path: string) => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined;
        const write = (path: string, bytes: Uint8Array) => { volume.writeFileSync(path, bytes); return true; };
        const target = "/out.mkv";
        const args = ["-y", "-v", "error", "-i", source, "-c:s", copy ? "copy" : "ass", target];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, read, write), "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { write(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
        }
        const bytes = volume.readFileSync(target) as Buffer;
        assert.ok(bytes.includes(Buffer.from("S_TEXT/ASS")));
        const track = parseMkv(bytes).tracks[0]!;
        const description = track.codecDescriptions[0]!;
        assert.equal(description.codecName, "ass");
        const header = Buffer.from(description.extraData!).toString();
        assert.ok(header.includes("[Script Info]"));
        assert.ok(header.includes("Style: Default,Arial,16,"));
        assert.ok(header.includes("[Events]"));
        if (copy) assert.deepEqual(description.extraData, parseMkv(native).tracks[0]!.codecDescriptions[0]!.extraData);
        assert.deepEqual(track.samples.map(sample => [sample.pts, sample.duration, Buffer.from(sample.data).toString()]), [[250, 875, packet]]);
      });
    }
}
