import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg: 4096 frames at 8000 Hz, sample = (i*331)%60001-30000;
// stereo right = (i*719+12345)%60001-30000. Encode adpcm_yamaha, then decode
// the encoded WAV to s16le (including final block padding).
for (const codec of ["yamaha-1", "yamaha-2"]) {
for (const sync of [false, true]) {
  it(`decodes ${codec} in WAV to native PCM16 (${sync ? "sync" : "async"})`, async () => {
    const input = readFileSync(new URL(`./fixtures/wav-${codec}.wav`, import.meta.url));
    const expected = readFileSync(new URL(`./fixtures/wav-${codec}.pcm`, import.meta.url));
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", input);
    const args = ["-v", "error", "-y", "-i", "/in.wav", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"];
    if (sync) {
      const result = evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
      assert.equal(result, "");
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
    const actual = volume.readFileSync("/out.raw") as Buffer;
    assert.equal(actual.length, expected.length);
    assert.deepEqual(actual, expected);
  });
}
}
