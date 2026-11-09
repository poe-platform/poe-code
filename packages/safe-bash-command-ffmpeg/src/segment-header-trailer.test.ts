import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

function source() {
  const input = Buffer.alloc(44 + 24000 * 2);
  Buffer.from("524946460000000057415645666d74201000000001000100401f0000803e0000020010006461746100000000", "hex").copy(input);
  input.writeUInt32LE(input.length - 8, 4);
  input.writeUInt32LE(input.length - 44, 40);
  for (let i = 0; i < 24000; i++) input.writeInt16LE(i, 44 + i * 2);
  return Volume.fromJSON({ "/ramp.wav": input });
}

async function run(volume: Volume, options: string[], input = "/ramp.wav", target = "/part%02d.wav") {
  const args = ["-v", "error", "-i", input, "-c", "copy", "-f", "segment",
    "-segment_list", "/parts.csv", ...options, target];
  const before = volume.toJSON();
  assert.equal(evalSyncFfmpeg(args, undefined,
    path => volume.readFileSync(path) as Buffer,
    (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
  assert.deepEqual(volume.toJSON(), before);
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

for (const value of [undefined, "0", "1"]) {
  it(`preserves segment PCM bytes and CSV times with write_header_trailer=${value ?? "default"}`, async () => {
    const volume = source();
    const result = await run(volume, value === undefined ? [] : ["-write_header_trailer", value]);
    assert.equal(result.exitCode, 0, result.stderr);
    const parts = [0, 1].map(index => volume.readFileSync(`/part0${index}.wav`) as Buffer);
    // Native FFmpeg 7.0.2: mono PCM16 at 8000 Hz, samples 0..23999.
    const payloads = value === "0" ? parts : parts.map(part => {
      assert.equal(part.subarray(0, 4).toString(), "RIFF");
      return Buffer.concat(parseWav(part).tracks[0]!.samples.map(sample => Buffer.from(sample.data)));
    });
    assert.deepEqual(payloads.map(part => part.length), [32768, 15232]);
    assert.deepEqual(Buffer.concat(payloads), (volume.readFileSync("/ramp.wav") as Buffer).subarray(44));
    assert.equal(volume.readFileSync("/parts.csv", "utf8"),
      "part00.wav,0.000000,2.048000\npart01.wav,2.048000,3.000000\n");
  });
}

for (const options of [[], ["-segment_format", "s16le"], ["-c:a", "pcm_s24le"],
  ["-segment_format", "s24le", "-c:a", "pcm_s24le"],
  ["-individual_header_trailer", "0"], ["-individual_header_trailer", "1"]]) {
  it(`preserves headerless PCM segment encoding and overwrite protection (${options.join(" ") || "copy"})`, async () => {
    const volume = source();
    volume.writeFileSync("/part00.wav", "keep segment");
    volume.writeFileSync("/parts.csv", "keep list");
    const before = volume.toJSON();
    const args = ["-write_header_trailer", "0", ...options];
    assert.notEqual((await run(volume, args)).exitCode, 0);
    assert.deepEqual(volume.toJSON(), before);
    const result = await run(volume, ["-y", ...args]);
    assert.equal(result.exitCode, 0, result.stderr);
    const parts = [0, 1].map(index => volume.readFileSync(`/part0${index}.wav`) as Buffer);
    const expected = options.includes("pcm_s24le") ? Buffer.alloc(24000 * 3)
      : (volume.readFileSync("/ramp.wav") as Buffer).subarray(44);
    if (options.includes("pcm_s24le")) {
      for (let i = 0; i < 24000; i++) expected.writeIntLE(i * 256, i * 3, 3);
    }
    assert.deepEqual(Buffer.concat(parts), expected);
  });
}

for (const value of ["", "2", "-1", "invalid"]) {
  it(`rejects invalid write_header_trailer=${JSON.stringify(value)} before replacing files`, async () => {
    const volume = source();
    volume.writeFileSync("/part00.wav", "keep segment");
    volume.writeFileSync("/parts.csv", "keep list");
    const before = volume.toJSON();
    const result = await run(volume, ["-y", "-write_header_trailer", value]);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("write_header_trailer"), result.stderr);
    assert.deepEqual(volume.toJSON(), before);
  });
}

it("rejects unsupported headerless MP4 segments before replacing files", async () => {
  const volume = Volume.fromJSON({
    "/in.mp4": Buffer.from(createSyntheticMp4({ width: 32, height: 32, frameCount: 12, fps: 4, includeAudio: false })),
    "/part00.mp4": "keep segment", "/parts.csv": "keep list"
  });
  const before = volume.toJSON();
  const result = await run(volume, ["-y", "-write_header_trailer", "0"], "/in.mp4", "/part%02d.mp4");
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.stderr.includes("write_header_trailer"), result.stderr);
  assert.deepEqual(volume.toJSON(), before);
});
