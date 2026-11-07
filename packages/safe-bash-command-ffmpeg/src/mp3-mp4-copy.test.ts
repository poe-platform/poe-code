import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { mp3Ast, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const sync of [false, true]) {
  it(`preserves MP3 encoder delay in MP4 (${sync ? "serializer" : "command"})`, async () => {
    const input = readFileSync(new URL("./fixtures/copy-mono.mp3", import.meta.url));
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.mp3", input);
    const args = ["-v", "error", "-i", "/in.mp3", "-c", "copy", "/out.mp4"];
    if (sync) {
      volume.writeFileSync("/out.mp4", serializeMp4(mp3Ast().parse(input)));
    } else {
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
    }
    const source = mp3Ast().parse(input).tracks[0]!;
    const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer);
    const track = output.tracks[0]!;
    assert.deepEqual(track.samples.map(sample => sample.data), source.samples.map(sample => sample.data));
    assert.equal(track.samples.length, 40);
    assert.equal(track.timescale, 44100);
    const remuxed = parseMp4(Buffer.from(serializeMp4(output))).tracks[0]!;
    assert.deepEqual(remuxed.editList, track.editList);
    assert.deepEqual(remuxed.samples.map(sample => sample.data), track.samples.map(sample => sample.data));
    // Native FFmpeg starts packets at -1105/44100 seconds with an edit spanning the unpadded audio.
    assert.equal(track.editList?.[0]?.mediaTime, 1105 * track.timescale / 44100);
    assert.equal(track.editList?.[0]?.segmentDuration,
      output.timescale);
  });
}
