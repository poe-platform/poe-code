import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createSyntheticMp4, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const samples = Array.from({ length: 800 }, (_, i) => (i - 400) / 32768);

for (const options of [
  ["-af", "volume=0", "-c:a", "copy"],
  ["-c", "copy", "-filter:a", "volume=0"],
  ["-acodec", "copy", "-af", "volume=0"],
  ["-filter:a", "volume=0", "-codec:a", "copy"]
]) {
  for (const existing of [false, true]) {
    it(`rejects audio copy with filtering (${options.join(" ")}, existing=${existing})`, async () => {
      const volume = Volume.fromJSON(existing ? { "/out.wav": "existing output" } : {});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples)] }));
      const args = ["-v", "error", "-y", "-i", "/in.wav", ...options, "/out.wav"];
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        () => { assert.fail("sync filtering must delegate without writing"); }), undefined);
      const result = await run(volume, args);
      assert.equal(result.exitCode, 218, result.stderr);
      assert.ok(result.stderr.includes("Filtering and streamcopy cannot be used together"), result.stderr);
      assert.equal(volume.existsSync("/out.wav"), existing);
      if (existing) assert.equal(volume.readFileSync("/out.wav", "utf8"), "existing output");
    });
  }
}

for (const copy of [false, true]) {
  it(`${copy ? "copy preserves samples" : "volume=0 writes silence"} without conflicting options`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [Float64Array.from(samples)] }));
    const result = await run(volume, ["-i", "/in.wav", ...(copy ? ["-c:a", "copy"] : ["-af", "volume=0"]), "/out.wav"]);
    assert.equal(result.exitCode, 0, result.stderr);
    const actual = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
    assert.deepEqual(Array.from(actual), copy ? samples : samples.map(() => 0));
  });
}

it("does not reject filters on excluded audio streams", async () => {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.mp4", createSyntheticMp4({ width: 16, height: 16, fps: 1, frameCount: 1, includeAudio: true }));
  const result = await run(volume, ["-i", "/in.mp4", "-f", "lavfi", "-i", "color=red:s=2x2:d=0.04", "-an", "-af", "volume=0", "-c:a", "copy", "-f", "null", "-"]);
  assert.equal(result.exitCode, 0, result.stderr);
});

async function run(volume: Volume, args: string[]) {
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
  return { ...result, stderr };
}
