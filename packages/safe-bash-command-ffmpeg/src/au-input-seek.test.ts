import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2 seeks AU input to complete interleaved PCM frames.
for (const [sampleRate, channels] of [[8000, 1], [48000, 1], [8000, 2]] as const) {
  for (const knownSize of [false, true]) {
    for (const [seek, first] of [["0", 0], ["0.03", sampleRate * 0.03]] as const) {
      it(`AU input seek ${seek} at ${sampleRate} Hz/${channels} ch, known size=${knownSize} matches native PCM bytes`, async () => {
        const input = Buffer.alloc(16024);
        [0x2e736e64, 24, knownSize ? 16000 : 0xffffffff, 3, sampleRate, channels]
          .forEach((value, index) => input.writeUInt32BE(value, index * 4));
        for (let i = 0; i < 8000; i++) input.writeInt16BE(i, 24 + i * 2);
        const volume = Volume.fromJSON({ "/input.au": input });
        const args = ["-ss", seek, "-i", "/input.au", "-c:a", "copy", "-f", "s16be", "/output"];
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          () => { assert.fail("AU input seeking must use the async path"); }), undefined);
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
        const output = volume.readFileSync("/output") as Buffer;
        const expected = input.subarray(24 + first * channels * 2);
        assert.equal(output.length, expected.length);
        assert.equal(output.equals(expected), true, "exact PCM payload");
      });
    }
  }
}
