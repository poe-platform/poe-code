import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) for (const channels of [1, 2]) {
  for (const size of [undefined, 32, 64, 8192, 16, 33, 16384]) {
    it(`${sync ? "sync" : "async"} IMA WAV block_size=${size} with ${channels} channels`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: Array.from({ length: channels }, (_, ch) =>
        Float64Array.from({ length: 160 }, (_, i) => ((i * channels + ch) * 331 % 60001 - 30000) / 32768)) });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      const options = ["-c:a", "adpcm_ima_wav", ...(size === undefined ? [] : ["-block_size", String(size)])];
      const args = ["-v", "error", "-i", "/in.wav", ...options, "/out.wav"];
      const invalid = size !== undefined && (size < 32 || size > 8192 || (size & (size - 1)) !== 0);
      if (sync) {
        const run = () => evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        if (invalid) { assert.equal(run(), undefined); assert.equal(volume.existsSync("/out.wav"), false); return; }
        assert.equal(run(), "");
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
        if (invalid) { assert.notEqual(result.exitCode, 0); assert.match(stderr, /block_size/); return; }
        assert.equal(result.exitCode, 0, stderr);
      }
      const output = volume.readFileSync("/out.wav") as Buffer;
      const align = size ?? 1024;
      const frames = 1 + (align - 4 * channels) * 2 / channels;
      const fmt = output.indexOf("fmt ") + 8;
      const data = output.subarray(output.indexOf("data") + 8);
      assert.equal(output.readUInt16LE(fmt + 12), align);
      assert.equal(output.readUInt16LE(fmt + 18), frames);
      assert.equal(output.readUInt32LE(output.indexOf("fact") + 8), 160);
      assert.equal(data.length, Math.ceil(160 / frames) * align);
      const native = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", ...options, "-f", "wav", "pipe:1"], { input });
      assert.equal(native.status, 0, native.stderr.toString());
      assert.deepEqual(data, native.stdout.subarray(native.stdout.indexOf("data") + 8));
      const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-f", "s16le", "pipe:1"], { input: output });
      assert.equal(decoded.status, 0, decoded.stderr.toString());
      assert.equal(decoded.stdout.length, Math.ceil(160 / frames) * frames * channels * 2);
    });
  }
}
