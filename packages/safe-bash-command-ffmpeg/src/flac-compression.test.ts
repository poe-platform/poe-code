import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { flacAst, wavAst } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  it(`default FLAC compression matches level 5 packets (${sync ? "sync" : "async"})`, async () => {
    const channels = [
      Float64Array.from({ length: 16 }, (_, i) => (i * 751 - 6000) / 32768),
      Float64Array.from({ length: 16 }, (_, i) => (8311 - 632 * i) / 32768)
    ];
    const input = encodeWav({ channels, sampleRate: 8000 });
    const outputs: Buffer[] = [];
    for (const level of [undefined, -1, 5]) {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", input);
      const args = ["-v", "error", "-i", "/in.wav", "-bitexact", "-c:a", "flac",
        ...(level === undefined ? [] : ["-compression_level", String(level)])];
      const run = async (output: string[]) => {
        if (sync) return evalSyncFfmpeg([...args, ...output], undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        let stdout = "", stderr = "";
        const result = await createFfmpegCommand().execute({
          args: [...args, ...output], cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); } },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        return stdout;
      };
      assert.equal(await run(["-f", "flac", "/out.flac"]), "");
      const output = volume.readFileSync("/out.flac") as Buffer;
      outputs.push(output);
      const decoded = flacAst().parse(output);
      assert.deepEqual(decoded.tracks[0]!.decodedAudio!.channelData, channels);
      if (!sync) {
        const hash = createHash("sha256");
        for (const packet of decoded.tracks[0]!.samples) hash.update(packet.data);
        assert.equal(await run(["-f", "hash", "pipe:1"]), `SHA256=${hash.digest("hex")}\n`);
      }
    }
    assert.deepEqual(outputs[0], outputs[2]);
    assert.deepEqual(outputs[1], outputs[2]);
  });
}

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
