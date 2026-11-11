import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const samples = [100, 200, 300, 400, 500, 600];
for (const sync of [false, true]) {
  for (const [flags, expected] of [
    [["-stream_loop", "1", "-ss", "0.004", "-noaccurate_seek"], [500, 600, ...samples]],
    [["-stream_loop", "1", "-ss", "0.004", "-accurate_seek"], [500, 600, 300, 400, 500, 600]],
    [["-stream_loop", "1", "-ss", "0.004", "-noaccurate_seek", "-accurate_seek"], [500, 600, 300, 400, 500, 600]],
    [["-stream_loop", "1", "-ss", "0.004", "-accurate_seek", "-noaccurate_seek"], [500, 600, ...samples]],
    [["-stream_loop", "1", "-ss", "0.004"], [500, 600, 300, 400, 500, 600]],
    [["-stream_loop", "2", "-ss", "0.004", "-accurate_seek"], [500, 600, 300, 400, 500, 600, ...samples]],
    [["-stream_loop", "1", "-ss", "0.005", "-accurate_seek"], [600, 500, 600]],
    [["-stream_loop", "1", "-ss", "0.002", "-accurate_seek"], [300, 400, 500, 600, ...samples]],
    [["-ss", "0.004", "-noaccurate_seek"], [500, 600]],
    [["-ss", "0.004", "-accurate_seek"], [500, 600]],
    [["-stream_loop", "0", "-noaccurate_seek"], samples],
    [["-stream_loop", "0", "-accurate_seek"], samples],
    [["-stream_loop", "0"], samples]
  ] as const) {
    it(`${sync ? "sync" : "async"} input ${flags.join(" ")}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 1000,
        channels: [Float64Array.from(samples, sample => sample / 32768)] }));
      const args = ["-v", "error", ...flags, "-i", "/in.wav", "-f", "s16le", sync ? "/out.raw" : "pipe:1"];
      let bytes: Buffer;
      if (sync) {
        const result = evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        assert.equal(result, "");
        bytes = volume.readFileSync("/out.raw") as Buffer;
      } else {
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        bytes = Buffer.concat(chunks);
      }
      assert.deepEqual(Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2)), expected);
    });
  }
}

for (const flag of ["-accurate_seek", "-noaccurate_seek"]) {
  for (const outputOption of [false, true]) {
    it(`${flag} ${outputOption ? "rejects output placement" : "resets before the next input"}`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 1000,
        channels: [Float64Array.from(samples, sample => sample / 32768)] }));
      const args = ["-v", "error", ...(outputOption
        ? ["-i", "/in.wav", flag]
        : [flag, "-i", "/in.wav", "-stream_loop", "1", "-ss", "0.004", "-i", "/in.wav", "-map", "1:a"]),
        "-f", "s16le", "pipe:1"];
      const chunks: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, outputOption ? 234 : 0, stderr);
      const bytes = Buffer.concat(chunks);
      assert.deepEqual(Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2)),
        outputOption ? [] : [500, 600, 300, 400, 500, 600]);
    });
  }
}
