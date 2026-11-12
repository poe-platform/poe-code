import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { wavpackAst } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// FFmpeg 7.0.2: 256 s16le stereo frames at 8000 Hz, sample (i, c) =
// ((i * 31337 + c * 997) % 65536) - 32768, encoded with -c:a wavpack
// -metadata 'title=Blue Room' -metadata 'artist=Two Voices'.
const tagged = readFileSync(new URL("./fixtures/wavpack-metadata.wv", import.meta.url));
const audio = tagged.subarray(0, tagged.readUInt32LE(4) + 8);

for (const sync of [false, true]) {
  for (const tags of [false, true]) {
    it(`exports WavPack metadata (${sync ? "sync" : "async"}, ${tags ? "tagged" : "untagged"})`, async () => {
      const volume = Volume.fromJSON({ "/in.wv": tags ? tagged : audio });
      const args = ["-y", "-v", "error", "-i", "/in.wv", "-bitexact", "-f", "ffmetadata", sync ? "/out.meta" : "pipe:1"];
      let stdout = "";
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      assert.equal(sync ? volume.readFileSync("/out.meta", "utf8") : stdout,
        ";FFMETADATA1\n" + (tags ? "title=Blue Room\nartist=Two Voices\n" : ""));
    });
  }
}

for (const withHeader of [false, true]) {
  it(`reads APE text tags with ${withHeader ? "a header and" : "only a"} footer`, () => {
    const input = withHeader ? tagged : Buffer.concat([audio, tagged.subarray(audio.length + 32)]);
    const doc = wavpackAst().parse(input, { decodeAudio: false });
    assert.equal(doc.metadata.title, "Blue Room");
    assert.equal(doc.metadata.artist, "Two Voices");
    assert.deepEqual(doc.tracks[0]!.samples[0]!.data, audio);
  });
}

it("does not expose binary APE items as text metadata", () => {
  const input = Buffer.from(tagged);
  input.writeUInt32LE(2, audio.length + 32 + 4);
  const doc = wavpackAst().parse(input, { decodeAudio: false });
  assert.equal(doc.metadata.title, undefined);
  assert.equal(doc.metadata.artist, "Two Voices");
});

it("bounds APE tag sizes, counts and item reads", () => {
  for (const [offset, value] of [
    [tagged.length - 32 + 12, 31],
    [tagged.length - 32 + 12, tagged.length + 1],
    [tagged.length - 32 + 16, 0xffffffff],
    [audio.length + 32, 0xffffffff]
  ]) {
    const input = Buffer.from(tagged);
    input.writeUInt32LE(value!, offset!);
    assert.throws(() => wavpackAst().parse(input, { decodeAudio: false }), /APE tag/);
  }
});
