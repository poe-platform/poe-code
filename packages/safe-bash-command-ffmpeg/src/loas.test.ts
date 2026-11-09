import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("../../mp4-ast/src/fixtures/loas.latm", import.meta.url));
const native = parseWav(readFileSync(new URL("../../mp4-ast/src/fixtures/loas-native.wav", import.meta.url)));
const expected = Buffer.concat(native.tracks[0]!.samples.map(sample => sample.data));

for (const sync of [false, true]) for (const copy of [false, true]) {
  it(`${sync ? "sync" : "async"} FFmpeg ${copy ? "copies LOAS packets unchanged" : "decodes LOAS to native PCM audio"}`, async () => {
    const output = copy ? "/out.latm" : "/out.wav";
    const volume = Volume.fromJSON({ "/in.bin": input });
    const args = ["-v", "error", "-y", "-i", "/in.bin", ...(sync ? [] : ["-map", "0:a:0"]), "-c:a", copy ? "copy" : "pcm_s16le", output];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
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
    const bytes = volume.readFileSync(output) as Buffer;
    if (copy) assert.deepEqual(bytes, input);
    else {
      const wav = parseWav(bytes);
      assert.equal(wav.tracks[0]!.codecDescriptions[0]!.sampleRate, 48000);
      const pcm = Buffer.concat(wav.tracks[0]!.samples.map(sample => sample.data));
      assert.equal(pcm.length, 31744 * 2);
      for (let i = 0; i < pcm.length; i += 2) {
        assert.ok(Math.abs(pcm.readInt16LE(i) - expected.readInt16LE(i)) <= 1, `sample ${i / 2}`);
      }
    }
  });
}
