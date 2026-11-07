import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  it(`preserves every int32 bit when re-encoding PCM32 WAV (${sync ? "sync" : "async"})`, async () => {
    const samples = [-2147483648, -2147483647, -1073741823, -257, -1, 0, 1, 257, 1073741825, 2147483647];
    const payload = Buffer.alloc(samples.length * 4);
    samples.forEach((sample, i) => payload.writeInt32LE(sample, i * 4));
    const input = Buffer.alloc(44 + payload.length);
    input.write("RIFF"); input.writeUInt32LE(input.length - 8, 4); input.write("WAVEfmt ", 8);
    input.writeUInt32LE(16, 16); input.writeUInt16LE(1, 20); input.writeUInt16LE(1, 22);
    input.writeUInt32LE(8000, 24); input.writeUInt32LE(32000, 28);
    input.writeUInt16LE(4, 32); input.writeUInt16LE(32, 34);
    input.write("data", 36); input.writeUInt32LE(payload.length, 40); payload.copy(input, 44);
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", input);
    let stderr = "";
    const args = ["-y", "-v", "error", "-i", "/in.wav", "-c:a", "pcm_s32le", "/out.wav"];
    if (sync) {
      const result = evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
      assert.equal(result, "");
    } else {
      const result = await createFfmpegCommand().execute({
        args,
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
    }
    const output = volume.readFileSync("/out.wav") as Buffer;
    let actual: Buffer | undefined;
    let format: Buffer | undefined;
    for (let offset = 12; offset + 8 <= output.length;) {
      const size = output.readUInt32LE(offset + 4);
      const chunk = output.subarray(offset + 8, offset + 8 + size);
      const tag = output.toString("ascii", offset, offset + 4);
      if (tag === "fmt ") format = chunk;
      if (tag === "data") actual = chunk;
      offset += 8 + size + (size % 2);
    }
    assert.ok(format);
    assert.equal(format.readUInt16LE(0), 1);
    assert.equal(format.readUInt16LE(14), 32);
    assert.ok(actual);
    assert.deepEqual(Array.from({ length: actual.length / 4 }, (_, i) => actual!.readInt32LE(i * 4)), samples);

    if (spawnSync("ffmpeg", ["-version"]).status === 0) {
      const reference = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-c:a", "pcm_s32le", "-f", "s32le", "pipe:1"], { input });
      assert.equal(reference.status, 0, reference.stderr.toString());
      assert.deepEqual(actual, reference.stdout);
      const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-f", "s16le", "pipe:1"], { input: output });
      assert.equal(decoded.status, 0, decoded.stderr.toString());
      const reference16 = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-f", "s16le", "pipe:1"], { input });
      assert.equal(reference16.status, 0, reference16.stderr.toString());
      assert.deepEqual(decoded.stdout, reference16.stdout);
      const probe = spawnSync("ffmpeg", ["-hide_banner", "-i", "pipe:0", "-f", "null", "-"], { input: output });
      assert.equal(probe.status, 0, probe.stderr.toString());
      assert.ok(probe.stderr.toString().includes("Audio: pcm_s32le"), probe.stderr.toString());
    }
  });
}
