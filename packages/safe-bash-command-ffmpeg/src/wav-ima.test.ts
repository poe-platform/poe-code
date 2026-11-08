import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) for (const badBlock of [-1, 0, 1, 2]) for (const index of [100, 256]) {
  it(`${sync ? "sync" : "async"} decodes stereo IMA WAV blocks to PCM16 (invalid block ${badBlock}, index ${index})`, async () => {
    // Three blocks, with opposite predictors in each channel and zero deltas.
    const input = Buffer.from("524946465400000057415645666d74201400000011000200401f00000000000010000400020009006461746130000000e803000018fc00000000000000000000d007000030f800000000000000000000b80b000048f400000000000000000000", "hex");
    if (badBlock >= 0) input.writeUInt16LE(index, input.indexOf("data") + 8 + badBlock * 16 + 6);
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", input);
    const args = ["-v", "error", "-i", "/in.wav", "-c:a", "pcm_s16le", "/out.wav"];
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
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.equal(audio.sampleRate, 8000);
    assert.equal(audio.channels, 2);
    for (let ch = 0; ch < 2; ch++) {
      assert.deepEqual(Array.from(audio.channelData[ch]!, n => n * 32768),
        [0, 1, 2].filter(block => block !== badBlock).flatMap(block => Array(9).fill((block + 1) * 1000 * (ch === 0 ? 1 : -1))));
    }
  });
}
