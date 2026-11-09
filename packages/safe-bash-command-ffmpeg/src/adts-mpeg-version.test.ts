import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { aacAst, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/adts-mpeg-version.m4a", import.meta.url));
// FFmpeg 7.0.2: -i adts-mpeg-version.m4a -c:a copy -write_mpeg2 1 adts-mpeg2.aac
const mpeg2 = readFileSync(new URL("./fixtures/adts-mpeg2.aac", import.meta.url));

function frames(bytes: Uint8Array): Uint8Array[] {
  const result: Uint8Array[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    assert.equal(bytes[offset], 0xff);
    assert.equal(bytes[offset + 1]! & 0xf6, 0xf0);
    const length = ((bytes[offset + 3]! & 3) << 11) | (bytes[offset + 4]! << 3) | (bytes[offset + 5]! >> 5);
    assert.ok(length >= 7 && offset + length <= bytes.length);
    result.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  return result;
}

function checkOutput(bytes: Uint8Array, enabled: boolean): void {
  const actual = frames(bytes);
  const reference = frames(mpeg2);
  assert.equal(actual.length, 18);
  for (let i = 0; i < actual.length; i++) {
    assert.equal(actual[i]![1]! & 8, enabled ? 8 : 0);
    const expected = Uint8Array.from(reference[i]!);
    expected[1] = enabled ? 0xf9 : 0xf1;
    assert.deepEqual(Uint8Array.from(actual[i]!), expected);
  }
}

for (const sync of [false, true]) {
  for (const value of [undefined, "0", "1", "true", "false"]) {
    it(`writes every ADTS frame with write_mpeg2=${value ?? "default"} (sync=${sync})`, async () => {
      const volume = Volume.fromJSON({ "/in.m4a": input });
      const args = ["-v", "error", "-y", "-i", "/in.m4a", "-c:a", "copy",
        ...(value === undefined ? [] : ["-write_mpeg2", value]), "/out.aac"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      } else {
        const result = await run(volume, args);
        assert.equal(result.exitCode, 0, result.stderr);
      }
      checkOutput(volume.readFileSync("/out.aac") as Buffer, value === "1" || value === "true");
    });
  }
  for (const value of ["2", "-1", "invalid"]) {
    it(`rejects write_mpeg2=${value} before replacing output (sync=${sync})`, async () => {
      const volume = Volume.fromJSON({ "/in.m4a": input, "/out.aac": "EXISTING" });
      const args = ["-y", "-i", "/in.m4a", "-c:a", "copy", "-write_mpeg2", value, "/out.aac"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
      } else {
        const result = await run(volume, args);
        assert.notEqual(result.exitCode, 0);
        assert.ok(result.stderr.includes("write_mpeg2"), result.stderr);
      }
      assert.equal(volume.readFileSync("/out.aac", "utf8"), "EXISTING");
    });
  }
}

it("supports the serialization API without mutating source AAC samples", () => {
  const doc = parseMp4(input);
  const before = doc.tracks[0]!.samples.map(sample => Uint8Array.from(sample.data));
  checkOutput(aacAst().serialize(doc, { writeMpeg2: true }), true);
  checkOutput(aacAst().serialize(doc, { writeMpeg2: false }), false);
  checkOutput(aacAst().serialize(doc), false);
  assert.deepEqual(doc.tracks[0]!.samples.map(sample => Uint8Array.from(sample.data)), before);
});

it("rewrites every already-framed sample without mutating it", () => {
  const doc = parseMp4(input);
  const track = doc.tracks[0]!;
  const framed = { ...doc, tracks: [{ ...track, samples: [{ ...track.samples[0]!, data: mpeg2 }] }] };
  for (const writeMpeg2 of [false, true]) {
    checkOutput(aacAst().serialize(framed, { writeMpeg2 }), writeMpeg2);
  }
  assert.ok(frames(mpeg2).every(frame => (frame[1]! & 8) === 8));
});

async function run(volume: InstanceType<typeof Volume>, args: string[]) {
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
