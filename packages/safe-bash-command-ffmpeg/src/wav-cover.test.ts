import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("../../mp4-ast/src/fixtures/wav-cover.wav", import.meta.url));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVQI12NkYPjPwMDAwMDAxAADABErAQPyz1XMAAAAAElFTkSuQmCC", "base64");
for (const cover of [false, true]) for (const sync of [false, true]) {
  it(`extracts WAV ID3 artwork byte-for-byte (cover=${cover}, sync=${sync})`, async () => {
    const bytes = cover ? input : Buffer.concat([input.subarray(0, 36), input.subarray(160)]);
    if (!cover) bytes.writeUInt32LE(bytes.length - 8, 4);
    const volume = Volume.fromJSON({ "/out.png": "keep" });
    volume.writeFileSync("/input.wav", bytes);
    const args = ["-v", "error", "-y", "-i", "/input.wav", "-map", "0:v:0", "-c", "copy", "-frames:v", "1", "/out.png"];
    if (sync) {
      const result = evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
        (path, data) => { volume.writeFileSync(path, data); return true; });
      // Image stream copy delegates to the full command, without writing output.
      assert.equal(result, undefined);
      assert.equal(volume.readFileSync("/out.png", "utf8"), "keep");
      return;
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
      assert.equal(result.exitCode, cover ? 0 : 234, stderr);
      if (!cover) assert.match(stderr, /matches no streams/);
    }
    assert.deepEqual(volume.readFileSync("/out.png"), cover ? png : Buffer.from("keep"));
  });
}
