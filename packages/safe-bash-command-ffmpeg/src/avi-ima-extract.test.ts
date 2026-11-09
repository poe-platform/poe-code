import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseAvi, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  it(`${sync ? "sync" : "async"} extracts AVI IMA ADPCM to WAV without changing encoded or decoded audio`, async () => {
    const input = readFileSync(new URL("../../mp4-ast/src/fixtures/ima-adpcm.avi", import.meta.url));
    const volume = Volume.fromJSON({ "/input.avi": input });
    const args = ["-i", "/input.avi", ...(sync ? ["-vn"] : ["-map", "0:a"]), "-c", "copy", "/out.wav"];
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
    const output = volume.readFileSync("/out.wav") as Buffer;
    const format = output.indexOf("fmt ") + 8;
    assert.equal(output.readUInt16LE(format), 17);
    assert.equal(output.readUInt16LE(format + 12), 1024);
    assert.equal(output.readUInt16LE(format + 14), 4);
    assert.equal(output.readUInt16LE(format + 18), 2041);
    const actual = parseWav(output).tracks[0]!;
    const expected = parseAvi(input, { decodeAudio: false }).tracks[1]!;
    assert.deepEqual(Buffer.concat(actual.samples.map(sample => sample.data)),
      Buffer.concat(expected.samples.map(sample => sample.data)));
    const decoded = actual.decodedAudio!.channelData[0]!;
    // Compare with the native FFmpeg 7.0.2 WAV stream copy using the same decoder.
    const reference = parseWav(readFileSync(new URL("../../mp4-ast/src/fixtures/ima-adpcm.wav", import.meta.url))).tracks[0]!;
    assert.equal(decoded.length * 2, 28574);
    assert.deepEqual(decoded, reference.decodedAudio!.channelData[0]);
  });
}
