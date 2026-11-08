import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

it("quantizes every signed PCM16 sample to unsigned PCM8 like FFmpeg", async () => {
  const input = encodeWav({ sampleRate: 8000,
    channels: [Float64Array.from({ length: 65536 }, (_, i) => (i - 32768) / 32768)] });
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", input);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", "-c:a", "pcm_u8", "/out.wav"],
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
  let payload: Buffer | undefined;
  let format: Buffer | undefined;
  for (let offset = 12; offset + 8 <= output.length;) {
    const size = output.readUInt32LE(offset + 4);
    const chunk = output.subarray(offset + 8, offset + 8 + size);
    const tag = output.toString("ascii", offset, offset + 4);
    if (tag === "fmt ") format = chunk;
    if (tag === "data") payload = chunk;
    offset += 8 + size + (size % 2);
  }
  assert.ok(format);
  assert.equal(format.readUInt16LE(0), 1);
  assert.equal(format.readUInt16LE(14), 8);
  assert.ok(payload);
  assert.equal(payload.length, 65536);
  for (let i = 0; i < payload.length; i++) {
    assert.equal(payload[i], i >>> 8, `PCM16 sample ${i - 32768}`);
  }

  if (spawnSync("ffmpeg", ["-version"]).status === 0) {
    const reference = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-c:a", "pcm_u8", "-f", "u8", "pipe:1"], { input });
    assert.equal(reference.status, 0, reference.stderr.toString());
    assert.deepEqual(payload, reference.stdout);
    const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-f", "s16le", "pipe:1"], { input: output });
    assert.equal(decoded.status, 0, decoded.stderr.toString());
    for (let i = 0; i < payload.length; i++) {
      assert.equal(decoded.stdout.readInt16LE(i * 2), (payload[i]! - 128) * 256);
    }
    const probe = spawnSync("ffmpeg", ["-hide_banner", "-i", "pipe:0", "-f", "null", "-"], { input: output });
    assert.equal(probe.status, 0, probe.stderr.toString());
    assert.ok(probe.stderr.toString().includes("Audio: pcm_u8"), probe.stderr.toString());
  }
});
