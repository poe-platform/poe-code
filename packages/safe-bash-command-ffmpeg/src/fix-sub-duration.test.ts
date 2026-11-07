import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseSubtitleDocument } from "@poe-code/mp4-ast";
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
  for (const fix of [false, true]) {
    it(`${sync ? "sync" : "async"} ${fix ? "fixes" : "preserves"} overlapping subtitle durations`, async () => {
      const result = await run(["-y", ...(fix ? ["-fix_sub_duration"] : []), "-i", "/in", "/out.vtt"], sync);
      assert.ok(result.success, result.stderr);
      const doc = parseSubtitleDocument(result.volume.readFileSync("/out.vtt") as Buffer, "webvtt");
      assert.deepEqual(doc.tracks[0]!.samples.map(sample => [sample.pts, sample.duration, new TextDecoder().decode(sample.data)]),
        fix ? [[1000, 1250, "Café costs €2"]] : [[1000, 2500, "Café costs €2"], [2250, 2750, "Second line"]]);
    });
  }
  it(`${sync ? "sync" : "async"} duration fixing leaves stream copy unchanged`, async () => {
    const result = await run(["-y", "-fix_sub_duration", "-i", "/in", "-c:s", "copy", "/out.srt"], sync);
    assert.ok(result.success, result.stderr);
    const doc = parseSubtitleDocument(result.volume.readFileSync("/out.srt") as Buffer, "srt");
    assert.deepEqual(doc.tracks[0]!.samples.map(s => [s.pts, s.duration]), [[1000, 2500], [2250, 2750]]);
  });
}
for (const sync of [false, true]) {
  it(`${sync ? "sync" : "async"} keeps gaps and drops the final buffered event`, async () => {
    const bytes = Buffer.from("1\n00:00:01,000 --> 00:00:02,000\nFirst\n\n2\n00:00:03,000 --> 00:00:04,000\nLast\n\n");
    const result = await run(["-y", "-fix_sub_duration", "-i", "/in", "/out.vtt"], sync, bytes);
    assert.ok(result.success, result.stderr);
    const doc = parseSubtitleDocument(result.volume.readFileSync("/out.vtt") as Buffer, "webvtt");
    assert.deepEqual(doc.tracks[0]!.samples.map(s => [s.pts, s.duration]), [[1000, 1000]]);
  });
}
it("duration fixing applies only to the next input", async () => {
  const result = await run(["-y", "-fix_sub_duration", "-i", "/in", "-i", "/in", "-map", "0:s", "/fixed.vtt", "-map", "1:s", "/plain.vtt"]);
  assert.ok(result.success, result.stderr);
  for (const [path, expected] of [["/fixed.vtt", [[1000, 1250]]], ["/plain.vtt", [[1000, 2500], [2250, 2750]]]] as const) {
    const doc = parseSubtitleDocument(result.volume.readFileSync(path) as Buffer, "webvtt");
    assert.deepEqual(doc.tracks[0]!.samples.map(s => [s.pts, s.duration]), expected);
  }
});
it("rejects the input option after the final input without writing output", async () => {
  const result = await run(["-y", "-i", "/in", "-fix_sub_duration", "/out.vtt"]);
  assert.equal(result.success, false);
  assert.equal(result.volume.existsSync("/out.vtt"), false);
});
