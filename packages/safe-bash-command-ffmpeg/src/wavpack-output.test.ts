import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { wavpackAst } from "@poe-code/mp4-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2: 256 stereo s16le frames at 8000 Hz, encoded with -c:a wavpack.
const input = readFileSync(new URL("./fixtures/wavpack-copy.wv", import.meta.url));
const stereo = readFileSync(new URL("./fixtures/frame-checksum-wavpack-stereo.wv", import.meta.url));

for (const pipe of [false, true]) {
  it(`copies WavPack packets to ${pipe ? "stdout" : "a .wv file"} without changing stereo PCM`, async () => {
    const fs = createMemoryFileSystem();
    await fs.writeFile("/in.wv", input);
    const chunks: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wv", "-c:a", "copy", ...(pipe ? ["-f", "wv", "pipe:1"] : ["/out.wv"])],
      command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: { async write(bytes) { chunks.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    assert.equal(result.exitCode, 0, stderr);
    const output = pipe ? Buffer.concat(chunks) : await fs.readFile("/out.wv");
    const doc = wavpackAst().parse(output);
    assert.equal(doc.duration, 256);
    const pcm = doc.tracks[0]!.decodedAudio!;
    assert.equal(pcm.sampleRate, 8000);
    assert.equal(pcm.channels, 2);
    for (let i = 0; i < 256; i++) for (let ch = 0; ch < 2; ch++) {
      assert.equal(pcm.channelData[ch]![i], (((i * 31337 + ch * 997) % 65536) - 32768) / 32768);
    }
  });
}

it("copies every WavPack block through synchronous FFmpeg without decoding", () => {
  const corrupted = Buffer.from(stereo);
  corrupted[28] = corrupted[28]! ^ 1; // A bad PCM checksum must not prevent packet copy.
  let output: Uint8Array | undefined;
  assert.equal(evalSyncFfmpeg(["-v", "error", "-y", "-i", "/in.wv", "-c:a", "copy", "/out.wv"], undefined,
    () => corrupted, (_path, bytes) => { output = bytes; return true; }), "");
  assert.ok(output);
  const doc = wavpackAst().parse(output, { decodeAudio: false });
  const original = wavpackAst().parse(corrupted, { decodeAudio: false });
  assert.equal(doc.tracks[0]!.samples.length, 6);
  assert.deepEqual(doc.tracks[0]!.samples.map(sample => Buffer.from(sample.data)), original.tracks[0]!.samples.map(sample => Buffer.from(sample.data)));
});

it("bounds WavPack muxing and rejects incompatible streams", () => {
  const plugin = wavpackAst();
  const doc = plugin.parse(input, { decodeAudio: false });
  assert.throws(() => plugin.serialize(doc, { limits: { maxOutputBytes: 1 } }), /maxOutputBytes/);
  assert.throws(() => plugin.serialize(doc, { limits: { maxMemoryBytes: 1 } }), /maxMemoryBytes/);
  assert.throws(() => plugin.serialize({ ...doc, tracks: [...doc.tracks, ...doc.tracks] }), /exactly one/);
  const track = doc.tracks[0]!;
  assert.throws(() => plugin.serialize({ ...doc, tracks: [{ ...track, codecDescriptions: [{ formatFourCC: "sowt", codecName: "pcm_s16le" }] }] }), /WavPack packets/);
});

it("does not silently copy packets when WavPack encoding is requested", () => {
  const plugin = wavpackAst();
  const doc = plugin.parse(input);
  assert.throws(() => plugin.serialize(doc, { audioCodec: "wavpack" }), /encoding is not supported/);
  assert.throws(() => plugin.serialize(doc), /encoding is not supported/);
});
