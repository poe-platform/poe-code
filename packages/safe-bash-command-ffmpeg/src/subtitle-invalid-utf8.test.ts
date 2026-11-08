import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseSubtitleDocument } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const invalid of [true, false]) {
  it(`${invalid ? "skips invalid UTF-8 with a diagnostic" : "preserves valid UTF-8 including replacement characters"}`, async () => {
    const first = invalid ? Buffer.from([67, 97, 102, 0xe9, 32, 99, 111, 115, 116, 115, 32, 0x80, 50]) : Buffer.from("Café costs €2 �");
    const input = Buffer.concat([
      Buffer.from("1\n00:00:01,000 --> 00:00:03,500\n"), first,
      Buffer.from("\n\n2\n00:00:02,250 --> 00:00:05,000\nSecond line\n\n")
    ]);
    assert.deepEqual(parseSubtitleDocument(input, "srt").tracks[0]!.samples[0]!.data, new Uint8Array(first));
    const volume = Volume.fromJSON({ "/in.srt": input });
    const args = ["-v", "error", "-y", "-i", "/in.srt", "/out.vtt"];
    if (invalid) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), undefined);
      assert.equal(volume.existsSync("/out.vtt"), false);
    }
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
    assert.equal(result.exitCode, 0, stderr);
    if (invalid) assert.match(stderr, /Invalid UTF-8 in decoded subtitles text/);
    else assert.equal(stderr, "");
    const output = parseSubtitleDocument(volume.readFileSync("/out.vtt") as Buffer, "webvtt");
    assert.deepEqual(output.tracks[0]!.samples.map(sample => [
      sample.pts, sample.duration, new TextDecoder().decode(sample.data)
    ]), [...(invalid ? [] : [[1000, 2500, "Café costs €2 �"]]), [2250, 2750, "Second line"]]);
  });
}
