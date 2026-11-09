import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMkv, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("../../mp4-ast/src/fixtures/tone-opus.mp4", import.meta.url));
for (const sync of [false, true]) for (const format of ["mkv", "webm", "mp4"]) {
  it(`${sync ? "sync" : "async"} preserves MP4 Opus configuration and packets when copying to ${format}`, async () => {
    const volume = Volume.fromJSON({ "/in.mp4": input });
    const output = `/out.${format}`;
    const args = ["-v", "error", "-i", "/in.mp4", ...(sync ? [] : ["-map", "0:a:0"]), "-c", "copy", output];
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
    const source = parseMp4(new Uint8Array(input), { decodeAudio: false }).tracks[0]!;
    const bytes = new Uint8Array(volume.readFileSync(output) as Buffer);
    const track = (format === "mp4" ? parseMp4(bytes, { decodeAudio: false }) : parseMkv(bytes)).tracks[0]!;
    assert.equal(track.samples.length, 38);
    assert.deepEqual(track.samples.map(sample => sample.data), source.samples.map(sample => sample.data));
    if (format === "mp4") {
      assert.deepEqual(track.codecDescriptions[0]!.dOps, source.codecDescriptions[0]!.dOps);
      assert.deepEqual(track.editList, source.editList);
    } else {
      assert.deepEqual(track.codecDescriptions[0]!.extraData, new Uint8Array([
        79, 112, 117, 115, 72, 101, 97, 100, 1, 1, 56, 1, 128, 187, 0, 0, 0, 0, 0
      ]));
      assert.equal(track.codecDelayNs, 6_500_000);
      assert.equal(track.seekPreRollNs, 80_000_000);
      assert.deepEqual(track.samples.slice(0, 5).map(sample => sample.pts), [-7, 14, 34, 54, 74]);
    }
  });
}
