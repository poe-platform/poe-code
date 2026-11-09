import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  it(`stream-copies native Matroska ACM PCM64 to WAV without losing low bits (sync=${sync})`, async () => {
    const input = readFileSync(new URL("../../mp4-ast/src/fixtures/pcm64-acm.mka", import.meta.url));
    const original = readFileSync(new URL("../../mp4-ast/src/fixtures/pcm64-acm.wav", import.meta.url));
    const volume = Volume.fromJSON({ "/depth64.mka": input });
    const args = ["-v", "error", "-y", "-i", "/depth64.mka", ...(sync ? [] : ["-map", "0:a"]), "-c:a", "copy", "-f", "wav", "/out.wav"];
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
    const track = parseWav(volume.readFileSync("/out.wav") as Buffer, { decodeAudio: false }).tracks[0]!;
    assert.equal(track.codecDescriptions[0]!.codecName, "pcm_s64le");
    assert.equal(track.codecDescriptions[0]!.sampleRate, 8000);
    assert.equal(track.codecDescriptions[0]!.channels, 1);
    assert.equal(track.codecDescriptions[0]!.bitsPerSample, 64);
    assert.deepEqual(Buffer.concat(track.samples.map(sample => Buffer.from(sample.data))), original.subarray(44));
  });
}
