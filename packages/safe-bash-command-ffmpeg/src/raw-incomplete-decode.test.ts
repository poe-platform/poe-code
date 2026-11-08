import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const frames of [0, 1, 512, 4000]) for (const trailing of [0, 1]) {
  it(`decodes ${frames} complete PCM16 samples with ${trailing} trailing bytes`, async () => {
    const pcm = Buffer.alloc(frames * 2);
    for (let index = 0; index < frames; index++) pcm.writeInt16LE(index - 2000, index * 2);
    const input = Buffer.concat([pcm, Buffer.alloc(trailing, 0x5a)]);
    const volume = Volume.fromJSON({ "/in.raw": input });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
        "-c:a", "pcm_s16le", "-f", "s16le", "/out.pcm"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (frames === 0 && trailing > 0) {
      assert.notEqual(result.exitCode, 0);
      assert.match(stderr, /Incomplete raw audio sample frame/);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(volume.readFileSync("/out.pcm"), pcm);
    }
  });
}
