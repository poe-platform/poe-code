import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

function chunks(bytes: Buffer): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    result.set(bytes.toString("ascii", offset, offset + 4), bytes.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size + (size % 2);
  }
  return result;
}

for (const channels of [1, 2]) for (const count of [1, 160, 4097]) for (const blockSize of [32, 1024, 8192]) {
  it(`encodes ${count} PCM frames to ${channels}-channel Microsoft ADPCM WAV with ${blockSize}-byte blocks`, async () => {
    const input = Buffer.alloc(count * channels * 2);
    for (let i = 0; i < count * channels; i++) input.writeInt16LE((i * 331) % 60001 - 30000, i * 2);
    const inputArgs = ["-f", "s16le", "-ar", "8000", "-ac", String(channels)];
    const codecArgs = ["-c:a", "adpcm_ms", "-block_size", String(blockSize)];
    const native = spawnSync("ffmpeg", ["-v", "error", ...inputArgs, "-i", "pipe:0", ...codecArgs, "-f", "wav", "pipe:1"], { input });
    assert.equal(native.status, 0, native.stderr.toString());
    const reference = chunks(native.stdout);
    const volume = Volume.fromJSON({ "/in.pcm": input });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", ...inputArgs, "-i", "/in.pcm", ...codecArgs, "/out.wav"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    const output = volume.readFileSync("/out.wav") as Buffer;
    const encoded = chunks(output);
    assert.deepEqual(encoded.get("fmt "), reference.get("fmt "));
    assert.deepEqual(encoded.get("data"), reference.get("data"));
    assert.equal(encoded.get("fact")!.readUInt32LE(), count);
    if (channels === 1 && count === 160 && blockSize === 1024) {
      assert.equal(encoded.get("data")!.length, 1024);
      assert.equal(encoded.get("data")!.subarray(0, 16).toString("hex"), "0010001b8cd08a777122232334343334");
    }
    const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-f", "s16le", "pipe:1"], { input: output });
    assert.equal(decoded.status, 0, decoded.stderr.toString());
    const audio = parseWav(output).tracks[0]!.decodedAudio!;
    assert.equal(decoded.stdout.length, audio.channelData[0]!.length * channels * 2);
    for (let i = 0; i < audio.channelData[0]!.length; i++) for (let ch = 0; ch < channels; ch++) {
      assert.equal(decoded.stdout.readInt16LE((i * channels + ch) * 2), audio.channelData[ch]![i]! * 32768);
    }
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: Array.from({ length: channels }, (_, ch) =>
      Float64Array.from({ length: count }, (_, i) => input.readInt16LE((i * channels + ch) * 2) / 32768)) }));
    assert.equal(evalSyncFfmpeg(["-v", "error", "-i", "/in.wav", ...codecArgs, "/sync.wav"], undefined,
      path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    assert.deepEqual(chunks(volume.readFileSync("/sync.wav") as Buffer).get("data"), encoded.get("data"));
  });
}
