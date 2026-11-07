import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, parseSubtitleDocument } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const srt = "1\n00:00:01,000 --> 00:00:03,500\nCafé costs €2\n\n2\n00:00:02,250 --> 00:00:05,000\nSecond line\n\n";
async function run(args: string[], sync = false, bytes: Uint8Array = Buffer.from(srt)) {
  const volume = Volume.fromJSON({ "/in": Buffer.from(bytes) });
  let stderr = "";
  const result = sync ? evalSyncFfmpeg(args, undefined,
    path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
    (path, data) => { volume.writeFileSync(path, data); return true; }) : await createFfmpegCommand().execute({
    args, cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  return { volume, success: sync ? result === "" : (result as { exitCode: number }).exitCode === 0, stderr };
}
for (const sync of [false, true]) {
  for (const [input, output, shift] of [[undefined, undefined, 0], ["0.5", undefined, 500], [undefined, "0.5", 500], ["-0.25", undefined, -250], [undefined, "-0.25", -250], ["-0.25", "500ms", 250]] as const) {
    it(`${sync ? "sync" : "async"} subtitle offsets ${input}/${output}`, async () => {
      const result = await run(["-y", ...(input ? ["-itsoffset", input] : []), "-i", "/in", ...(output ? ["-output_ts_offset", output] : []), "/out.vtt"], sync);
      assert.ok(result.success, result.stderr);
      const doc = parseSubtitleDocument(result.volume.readFileSync("/out.vtt") as Buffer, "webvtt");
      assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]),
        [[1000 + shift, 2500, "Café costs €2"], [2250 + shift, 2750, "Second line"]]);
    });
  }
  it(`${sync ? "sync" : "async"} M4A copy preserves packets and shifts priming timestamps`, async () => {
    const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/packet-positions-interleaved.mp4", import.meta.url));
    const source = parseMp4(bytes);
    const result = await run(["-y", "-i", "/in", "-vn", "-c", "copy", "-output_ts_offset", "0.25", "/out.m4a"], sync, bytes);
    assert.ok(result.success, result.stderr);
    const doc = parseMp4(result.volume.readFileSync("/out.m4a") as Buffer);
    const track = doc.tracks[0]!;
    const original = source.tracks.find(track => track.type === "audio")!;
    assert.deepEqual(track.samples.map(s => s.data), original.samples.map(s => s.data));
    assert.equal(track.editList![0]!.segmentDuration / doc.timescale,
      Math.floor((.25 - original.editList![0]!.mediaTime / original.timescale) * 1000) / 1000);
    assert.equal(track.editList![0]!.mediaTime, -1);
    assert.equal(track.editList![1]!.mediaTime, 0);
  });
}
it("input offsets apply only to the next input and output offsets reset between outputs", async () => {
  const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/packet-positions-interleaved.mp4", import.meta.url));
  const result = await run(["-y", "-i", "/in", "-itsoffset", "0.5", "-i", "/in", "-i", "/in", "-map", "0:v", "-map", "1:a", "-c", "copy", "-output_ts_offset", "2", "/out.mp4", "-map", "2:v", "-c", "copy", "/plain.mp4"], false, bytes);
  assert.ok(result.success, result.stderr);
  const doc = parseMp4(result.volume.readFileSync("/out.mp4") as Buffer);
  const video = doc.tracks[0]!;
  assert.equal((video.samples[0]!.pts - video.editList![1]!.mediaTime) / video.timescale + video.editList![0]!.segmentDuration / doc.timescale, 2);
  assert.equal((video.samples[0]!.dts - video.editList![1]!.mediaTime) / video.timescale + video.editList![0]!.segmentDuration / doc.timescale, 1.6);
  assert.deepEqual(doc.tracks.map(track => track.samples.length), [5, 9]);
  const source = parseMp4(bytes).tracks.find(t => t.type === "audio")!;
  assert.equal(doc.tracks[1]!.editList![0]!.segmentDuration / doc.timescale, Math.floor((2.5 - source.editList![0]!.mediaTime / source.timescale) * 1000) / 1000);
  const plain = parseMp4(result.volume.readFileSync("/plain.mp4") as Buffer);
  assert.ok(!plain.tracks[0]!.editList?.some(edit => edit.mediaTime < 0));
});
for (const args of [["-itsoffset", "NaN", "-i", "/in"], ["-i", "/in", "-itsoffset", "0.5"], ["-output_ts_offset", "0.5", "-i", "/in"], ["-i", "/in", "-output_ts_offset", "Infinity"]]) {
  it(`rejects invalid offset arguments ${args.join(" ")}`, async () => {
    const result = await run([...args, "/out.vtt"]);
    assert.equal(result.success, false);
    assert.equal(result.volume.existsSync("/out.vtt"), false);
  });
}
