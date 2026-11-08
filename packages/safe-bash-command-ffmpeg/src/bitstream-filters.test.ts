import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodeWav } from "@poe-code/audio-ast";
import { it } from "node:test";
import { Volume } from "memfs";
import { concatBytes, createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const aac of [false, true]) {
    it(`aac_adtstoasc validates the audio codec (aac=${aac}, sync=${sync})`, async () => {
      const input = aac
        ? readFileSync(new URL("../../mp4-ast/src/fixtures/aac-external.mp4", import.meta.url))
        : encodeWav({ sampleRate: 8000, channels: [Float64Array.from({ length: 20 }, (_, i) => (i + 1) / 32768)] });
      const source = aac ? "/in.m4a" : "/in.wav";
      const target = aac ? "/out.m4a" : "/out.wav";
      const volume = Volume.fromJSON({ [source]: Buffer.from(input), [target]: "EXISTING" });
      const args = ["-v", "error", "-y", "-i", source, "-c:a", "copy", "-bsf:a", "null,aac_adtstoasc,null", target];
      if (sync) {
        const result = evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
        assert.equal(result, aac ? "" : undefined);
      } else {
        const result = await run(volume, args);
        if (aac) assert.equal(result.exitCode, 0, result.stderr);
        else {
          assert.notEqual(result.exitCode, 0);
          assert.ok(result.stderr.includes("aac_adtstoasc") && result.stderr.includes("pcm_s16le"), result.stderr);
        }
      }
      if (aac) {
        assert.deepEqual(parseMp4(volume.readFileSync(target) as Buffer).tracks[0]!.samples.map(sample => sample.data),
          parseMp4(input).tracks[0]!.samples.map(sample => sample.data));
      } else assert.equal(volume.readFileSync(target, "utf8"), "EXISTING");
    });
  }
}

for (const flag of ["-bsf:v", "-bsf:a", "-bsf", "-bsf:v:0"]) {
  for (const filter of ["not_a_filter", "h264_metadata=aud=bogus", "null,not_a_filter", "null=bogus", "null,", ""]) {
    it(`preserves existing output for ${flag} ${JSON.stringify(filter)}`, async () => {
      const volume = Volume.fromJSON({
        "/in.mp4": Buffer.from(createSyntheticMp4({ width: 16, height: 16, frameCount: 4 })),
        "/out.mp4": "EXISTING"
      });
      const args = ["-v", "error", "-y", "-i", "/in.mp4", "-c:v", "copy", flag, filter, "/out.mp4"];
      let writes = 0;
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        () => { writes++; return true; }), undefined);
      assert.equal(writes, 0);
      const result = await run(volume, args);
      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("bitstream filter"), result.stderr);
      assert.equal(volume.readFileSync("/out.mp4", "utf8"), "EXISTING");
    });
  }
}

for (const sync of [false, true]) {
  for (const filter of [undefined, "null", "null,null"]) {
    it(`preserves packet bytes with ${filter ?? "no filter"} (sync=${sync})`, async () => {
      const input = createSyntheticMp4({ width: 16, height: 16, frameCount: 4 });
      const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input), "/out.mp4": "EXISTING" });
      const args = ["-y", "-i", "/in.mp4", "-c:v", "copy", ...(filter ? ["-bsf:v", filter] : []), "/out.mp4"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      } else {
        const result = await run(volume, args);
        assert.equal(result.exitCode, 0, result.stderr);
      }
      assert.deepEqual(parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!.samples.map(sample => Array.from(sample.data)),
        parseMp4(input).tracks[0]!.samples.map(sample => Array.from(sample.data)));
    });
  }
}

for (const sync of [false, true]) {
  for (const filter of [
    "h264_metadata=aud=insert",
    "h264_metadata=aud=insert,h264_metadata=aud=insert",
    "h264_metadata=aud=insert,filter_units=remove_types=9",
    "filter_units=remove_types=9,h264_metadata=aud=insert"
  ]) {
    it(`inserts H.264 delimiters in chain order with ${filter} (sync=${sync})`, async () => {
      const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 4, frameCount: 4 }));
      const track = doc.tracks[0]!;
      const sei = new Uint8Array([0, 0, 0, 4, 6, 0, 0, 128]);
      const samples = track.samples.map((sample, index) => ({
        ...sample, data: index === 0 ? concatBytes([sei, sample.data]) : sample.data
      }));
      const input = serializeMp4({ ...doc, tracks: [{ ...track, samples }] });
      const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
      const args = ["-y", "-i", "/in.mp4", "-c:v", "copy", "-bsf:v", filter, "/out.mp4"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      } else {
        const result = await run(volume, args);
        assert.equal(result.exitCode, 0, result.stderr);
      }
      const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!;
      assert.equal(output.samples.length, samples.length);
      for (const [index, sample] of output.samples.entries()) {
        const original = samples[index]!;
        const delimiter = filter.endsWith("remove_types=9") ? new Uint8Array() : new Uint8Array([0, 0, 0, 2, 9, 240]);
        assert.deepEqual(Array.from(sample.data), Array.from(concatBytes([delimiter, original.data])));
        assert.equal(sample.duration, original.duration);
        assert.equal(sample.isKeyframe, original.isKeyframe);
      }
    });
  }
}

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
