import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const scenario of ["pcm encoder", "pcm copy", "duplicate maps"] as const) {
  it(`rejects MP3 output with ${scenario} before writing bytes`, async () => {
    const volume = Volume.fromJSON({});
    const duplicate = scenario === "duplicate maps";
    const input = duplicate ? "/in.mp3" : "/in.wav";
    volume.writeFileSync(input, duplicate
      ? readFileSync(new URL("./fixtures/copy-mono.mp3", import.meta.url))
      : encodeWav({ sampleRate: 8000, channels: [new Float64Array(80)] }));
    const args = ["-v", "error", "-i", input,
      ...(duplicate ? ["-map", "0:a", "-map", "0:a"] : []),
      "-c:a", scenario === "pcm encoder" ? "pcm_s16le" : "copy", "/out.mp3"];
    assert.equal(evalSyncFfmpeg(args, undefined,
      path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
    assert.equal(volume.existsSync("/out.mp3"), false);
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
    assert.notEqual(result.exitCode, 0, stderr);
    assert.ok(stderr.includes(duplicate ? "exactly one audio track" : "MP3"), stderr);
    assert.equal(volume.existsSync("/out.mp3"), false);
  });
}
