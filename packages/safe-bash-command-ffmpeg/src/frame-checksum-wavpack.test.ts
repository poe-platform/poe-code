import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { wavpackAst } from "@poe-code/mp4-ast";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/frame-checksum-wavpack.wv", import.meta.url));
const wav = readFileSync(new URL("./fixtures/frame-checksum-wavpack.wav", import.meta.url));

async function run(args: string[], bytes: Uint8Array = input) {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/in.wv", bytes);
  let stdout = "", stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wv", ...args],
    command: "ffmpeg", cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
  });
  assert.equal(result.exitCode, 0, stderr);
  return { stdout, fs };
}

// Packet boundaries and hashes independently recorded with native FFmpeg 7.0.2.
it("copies the WavPack packet without trailing APE tags", async () => {
  const { stdout } = await run(["-c:a", "copy", "-f", "framemd5", "-"]);
  assert.ok(stdout.includes("#codec_id 0: wavpack\n"));
  assert.ok(stdout.includes("#tb 0: 1/48000\n"));
  assert.deepEqual(stdout.split("\n").filter(line => line.startsWith("0,")), [
    "0,          0,          0,    19200,     9188, 993463ec4c44d01ed6ccf8964aa85c83"
  ]);
});

it("decodes lossless WavPack with native PCM packet size and checksum", async () => {
  const { stdout } = await run(["-f", "framemd5", "-"]);
  assert.ok(stdout.includes("#codec_id 0: pcm_s16le\n"));
  assert.deepEqual(stdout.split("\n").filter(line => line.startsWith("0,")), [
    "0,          0,          0,    19200,    38400, 93b07119b6611955bd673ee6a575a807"
  ]);
});

it("decodes WavPack to the original WAV audio bytes", async () => {
  const { fs } = await run(["-f", "s16le", "/pcm"]);
  let offset = 12;
  while (wav.toString("ascii", offset, offset + 4) !== "data") offset += 8 + wav.readUInt32LE(offset + 4) + (wav.readUInt32LE(offset + 4) & 1);
  assert.deepEqual(Buffer.from(await fs.readFile("/pcm")), wav.subarray(offset + 8, offset + 8 + wav.readUInt32LE(offset + 4)));
});

// Native FFmpeg stereo fixture uses six blocks, including a short final block.
it("retains stereo WavPack block boundaries and decoded hashes", async () => {
  const stereo = readFileSync(new URL("./fixtures/frame-checksum-wavpack-stereo.wv", import.meta.url));
  const { stdout } = await run(["-f", "framemd5", "-"], stereo);
  const hashes = ["c61ae81669a54f501a7b41889e93fb63", "cb7fd792485d5ed50d7132af95353b57",
    "e4b6d59b8996f2a95bc34c56a5c4ccd6", "1713f0cdbeb78f63193fdde7887529d2",
    "54f67b5368dd8e19a847444f9a8ef1d9", "64bad779a32f1ee2eb8810ba85e199d2"];
  const rows = stdout.split("\n").filter(line => line.startsWith("0,")).map(line => line.split(",").map(field => field.trim()));
  assert.equal(rows.length, hashes.length);
  for (const [i, row] of rows.entries()) {
    const count = i === 5 ? 160 : 256;
    assert.deepEqual(row.slice(0, 5).map(Number), [0, i * 256, i * 256, count, count * 4]);
    assert.equal(row[5], hashes[i]);
  }
});

it("rejects truncated WavPack input and corrupted decoded audio", async () => {
  await assert.rejects(run(["-f", "framemd5", "-"], input.subarray(0, 9000)), /Invalid WavPack block size/);
  const corrupted = Uint8Array.from(input);
  corrupted[28] = corrupted[28]! ^ 1;
  await assert.rejects(run(["-f", "framemd5", "-"], corrupted), /WavPack audio checksum mismatch/);
  // Copy never invokes the PCM decoder, even when the decoded checksum is wrong.
  const { stdout } = await run(["-c:a", "copy", "-f", "framemd5", "-"], corrupted);
  assert.ok(stdout.includes("#codec_id 0: wavpack"));
});

it("bounds WavPack duration, memory, packets and metadata reads", () => {
  const plugin = wavpackAst();
  assert.throws(() => plugin.parse(input, { limits: { maxDurationSeconds: 0.1 } }), /maxDurationSeconds/);
  assert.throws(() => plugin.parse(input, { limits: { maxMemoryBytes: 1000 } }), /maxMemoryBytes/);
  assert.throws(() => plugin.parse(input, { limits: { maxSamplesPerTrack: 0 } }), /maxSamplesPerTrack/);
  const corrupted = Uint8Array.from(input);
  corrupted[32] = 0x82;
  corrupted.fill(255, 33, 36);
  assert.throws(() => plugin.parse(corrupted), /Invalid WavPack metadata size/);
  const probe = plugin.parse(input, { decodeAudio: false, limits: { maxMemoryBytes: 0 } });
  assert.equal(probe.tracks[0]!.decodedAudio, undefined);
  assert.equal(probe.tracks[0]!.samples[0]!.data.length, 9188);
});
