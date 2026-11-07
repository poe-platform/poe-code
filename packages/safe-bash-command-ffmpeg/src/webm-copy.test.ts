import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { readOgg } from "@poe-code/audio-ast";
import { parseMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Vorbis fixture: ffmpeg -f lavfi -i sine=r=48000:d=0.05 -ac 2 -c:a vorbis -strict experimental vorbis.ogg
for (const sync of [false, true]) {
  for (const [input, valid] of [
    ["h264-b-frames.mkv", false], ["aac-external.mp4", false],
    ["vorbis.ogg", true], ["opus-delay.webm", true],
    ["in.srt", false], ["in.vtt", true]
  ] as const) {
    for (const format of ["webm", "forced-webm", "matroska"] as const) {
      it(`${sync ? "sync" : "async"} copies ${input} to ${format} only with compatible codecs`, async () => {
        const bytes = input === "in.srt" ? Buffer.from("1\n00:00:00,000 --> 00:00:01,000\nHello\n")
          : input === "in.vtt" ? Buffer.from("WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n")
          : readFileSync(new URL(input === "vorbis.ogg" ? "./fixtures/vorbis.ogg" : `../../mp4-ast/src/fixtures/${input}`, import.meta.url));
        const volume = Volume.fromJSON({ [`/${input}`]: bytes });
        const target = format === "webm" ? "/out.webm" : "/out.mkv";
        const accepted = valid || format === "matroska";
        const args = ["-i", `/${input}`, ...(sync ? [] : ["-map", "0"]), "-c", "copy",
          ...(format === "forced-webm" ? ["-f", "webm"] : []), target];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, data) => { volume.writeFileSync(path, data); return true; }), accepted ? "" : undefined);
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
          if (accepted) assert.equal(result.exitCode, 0, stderr);
          else {
            assert.notEqual(result.exitCode, 0);
            assert.match(stderr, /Cannot copy .* codec .* to webm/);
          }
        }
        assert.equal(volume.existsSync(target), accepted);
        if (accepted) {
          const track = parseMkv(new Uint8Array(volume.readFileSync(target) as Buffer)).tracks[0]!;
          assert.ok(track);
          if (input === "vorbis.ogg") {
            const { packets } = readOgg(bytes);
            const extra = track.codecDescriptions[0]!.extraData!;
            assert.ok(extra, "Vorbis decoder headers must survive stream copy");
            assert.equal(extra[0], 2);
            let cursor = 1;
            const lengths = [0, 0];
            for (let i = 0; i < 2; i++) {
              let size: number;
              do { size = extra[cursor++]!; lengths[i]! += size; } while (size === 255);
            }
            lengths.push(extra.length - cursor - lengths[0]! - lengths[1]!);
            for (const [index, length] of lengths.entries()) {
              assert.deepEqual(extra.slice(cursor, cursor + length), packets[index]!.data);
              cursor += length;
            }
            assert.deepEqual(track.samples.map(sample => sample.data), packets.slice(3).map(packet => packet.data));
          }
        }
      });
    }
  }
}
