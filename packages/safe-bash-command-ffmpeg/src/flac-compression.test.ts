import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { flacAst, wavAst } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const bits of [16, 24] as const) for (const sync of [false, true]) {
  it(`FLAC compression levels preserve ${bits}-bit PCM (${sync ? "sync" : "async"})`, async () => {
    const channels = Array.from({ length: 2 }, (_, channel) => Float64Array.from({ length: 5000 },
      (_, i) => ((i * 997 + channel * 17111) % 2 ** (bits - 1) - 2 ** (bits - 2)) / 2 ** (bits - 1)));
    const input = encodeWav({ channels, sampleRate: 16000 }, { bitsPerSample: bits });
    const sizes: number[] = [];
    for (const level of [0, 5, 12, -1]) {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", input);
      const args = ["-y", "-v", "error", "-i", "/in.wav", "-compression_level", String(level), "/out.flac"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); } },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const output = volume.readFileSync("/out.flac") as Buffer;
      const decoded = flacAst().parse(output).tracks[0]!.decodedAudio!;
      assert.deepEqual(decoded.channelData.map(data => Array.from(data)), channels.map(data => Array.from(data)));
      sizes.push(output.length);
    }
    assert.ok(sizes[2]! < sizes[0]!, "higher levels must improve compression for predictable PCM");
    assert.ok(sizes[2]! < input.length);
  });
}

for (const level of [-2, 13, 1.5, NaN]) {
  it(`rejects invalid FLAC compression level ${level}`, async () => {
    const input = encodeWav({ channels: [new Float64Array(32)], sampleRate: 16000 });
    const doc = wavAst().parse(input);
    assert.throws(() => flacAst().serialize(doc, { compressionLevel: level }), /compression_level/);
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", input);
    let stderr = "", wrote = false;
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.wav", "-compression_level", String(level), "/out.flac"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile() { return input; }, async stat(path: string) { return volume.statSync(path); },
        async writeFile() { wrote = true; } },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.match(stderr, /compression_level/);
    assert.equal(wrote, false);
  });
}
