import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  it(`preserves native Matroska DisplayUnit=3 aspect ratio in MP4 stream copies (sync=${sync})`, async () => {
    const input = readFileSync(new URL('../../mp4-ast/src/fixtures/display-unit-ratio.mkv', import.meta.url));
    const volume = Volume.fromJSON({ "/in.mkv": input });
    const args = ["-y", "-v", "error", "-i", "/in.mkv", ...(sync ? [] : ["-map", "0:v"]), "-c", "copy", "/out.mp4"];
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
    const track = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!;
    assert.equal(track.width, 64);
    assert.equal(track.height, 48);
    assert.equal(track.codecDescriptions[0]!.sarWidth, 4);
    assert.equal(track.codecDescriptions[0]!.sarHeight, 3);
    assert.equal(track.samples.length, 2);
  });
}
