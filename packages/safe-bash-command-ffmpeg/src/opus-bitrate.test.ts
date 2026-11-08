import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  it(`honors Opus bitrate in ${sync ? "sync" : "async"} encoding`, async () => {
    const input = encodeWav({ sampleRate: 48000, channels: [Float64Array.from({ length: 36000 },
      (_, index) => 0.125 * Math.sin(index * 440 * 2 * Math.PI / 48000))] });
    const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
    for (const bitrate of ["16k", "128k", "16000", "0.016M", "0", "-1", "bogus", "k", "", "513k", "4294967296"]) {
      const valid = ["16k", "128k", "16000", "0.016M", "0"].includes(bitrate);
      const args = ["-i", "/in.wav", "-c:a", "libopus", "-b:a", bitrate, `/${bitrate}.opus`];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), valid ? "" : undefined);
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
        assert.equal(result.exitCode, valid ? 0 : 1, stderr);
      }
      if (!valid) assert.equal(volume.existsSync(`/${bitrate}.opus`), false);
    }
    const low = volume.readFileSync("/16k.opus") as Buffer;
    const high = volume.readFileSync("/128k.opus") as Buffer;
    assert.ok(high.length > low.length * 3, `${low.length} bytes at 16k, ${high.length} bytes at 128k`);
    assert.deepEqual(volume.readFileSync("/16000.opus"), low);
    assert.deepEqual(volume.readFileSync("/0.016M.opus"), low);
  });
}
