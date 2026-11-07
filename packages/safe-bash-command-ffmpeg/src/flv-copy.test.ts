import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, parseFlv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native fixture: ffmpeg -f lavfi -i testsrc2=s=64x48:r=5:d=2 -c:v mpeg4 -threads 1 mpeg4.mp4
for (const codec of ["mpeg4", "h264"] as const) {
  for (const sync of [false, true]) {
    for (const explicitFormat of [false, true]) {
      it(`${sync ? "sync" : "async"} ${explicitFormat ? "explicit" : "inferred"} FLV copy ${codec === "mpeg4" ? "rejects MPEG-4 Part 2" : "preserves H.264"}`, async () => {
        const input = readFileSync(new URL(codec === "mpeg4" ? "./fixtures/mpeg4.mp4" : "../../mp4-ast/src/fixtures/h264-b-frames.mp4", import.meta.url));
        const source = parseMp4(new Uint8Array(input)).tracks.find(track => track.type === "video")!;
        assert.equal(source.codecDescriptions[0]!.codecName, codec);
        const volume = Volume.fromJSON({ "/in.mp4": input });
        const target = explicitFormat ? "/out.bin" : "/out.flv";
        const args = ["-y", "-v", "error", "-i", "/in.mp4", ...(sync ? ["-an"] : ["-map", "0:v"]), "-c", "copy", ...(explicitFormat ? ["-f", "flv"] : []), target];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), codec === "mpeg4" ? undefined : "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: volume.promises,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          if (codec === "mpeg4") {
            assert.notEqual(result.exitCode, 0);
            assert.ok(stderr.includes("Cannot copy video codec 'mpeg4' to flv; use video transcoding."), stderr);
          } else assert.equal(result.exitCode, 0, stderr);
        }
        assert.equal(volume.existsSync(target), codec !== "mpeg4");
        if (codec === "h264") {
          const output = parseFlv(new Uint8Array(volume.readFileSync(target) as Buffer));
          assert.equal(output.tracks[0]!.codecDescriptions[0]!.codecName, "h264");
          assert.deepEqual(output.tracks[0]!.samples.map(sample => sample.data), source.samples.map(sample => sample.data));
        }
      });
    }
  }
}
