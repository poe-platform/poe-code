import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { it } from "node:test";
import { encodeWav } from "@poe-code/audio-ast";
import { flacAst } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const bits of [24] as const) for (const sync of [false, true]) {
  it(`FLAC sample_fmt converts ${bits}-bit PCM (${sync ? "sync" : "async"})`, async () => {
    const channels = Array.from({ length: 2 }, (_, channel) => Float64Array.from({ length: 16384 },
      (_, i) => ((i * 997 + channel * 17111) % 2 ** (bits - 1) - 2 ** (bits - 2)) / 2 ** (bits - 1)));
    const input = encodeWav({ channels, sampleRate: 16000 }, { bitsPerSample: bits });
    
    for (const format of ["s16", "s32"]) {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", input);
      const args = ["-y", "-v", "error", "-i", "/in.wav", "-sample_fmt", format, "/out.flac"];
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
      const precision = format === "s16" ? 16 : 24;
      assert.equal(flacAst().parse(output).tracks[0]!.codecDescriptions[0]!.bitsPerSample, precision);
      assert.deepEqual(decoded.channelData.map(data => Array.from(data)), channels.map(data =>
        Array.from(data, value => Math.floor(value * 2 ** (precision - 1)) / 2 ** (precision - 1))));
      if (format === "s16") {
        const pcm = Buffer.alloc(16384 * 4);
        for (let i = 0; i < 16384; i++) for (let c = 0; c < 2; c++)
          pcm.writeInt16LE(decoded.channelData[c]![i]! * 32768, (i * 2 + c) * 2);
        assert.equal(createHash("md5").update(pcm).digest("hex"), "6dd24a8ff88b22358563c11842fe68d3");
      }
    }
  });
}

for (const options of [["-sample_fmt", "flt"], ["-sample_fmt", "invalid"]]) {
  it(`rejects invalid FLAC output: ${options.join(" ")}`, async () => {
    const input = encodeWav({ channels: [new Float64Array(32)], sampleRate: 16000 });
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", input);
    const args = ["-v", "error", "-i", "/in.wav", ...options, "/out.flac"];
    assert.equal(evalSyncFfmpeg(args, undefined,
      path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
    assert.equal(volume.existsSync("/out.flac"), false);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); } },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("sample_fmt"), stderr);
    assert.equal(volume.existsSync("/out.flac"), false);
  });
}
