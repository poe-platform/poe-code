import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseAudio, writeAudioMetadata } from "@poe-code/audio-ast";
import { flacAst } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const source = parseAudio(readFileSync(new URL("./fixtures/comments.flac", import.meta.url)));
const input = writeAudioMetadata({ ...source, tags: {} }, { albumArtist: "First", title: "Keep" });
const samples = flacAst().parse(input).tracks[0]!.decodedAudio!.channelData;

// Native FFmpeg 7.0.2 replaces either spelling, but deleting the physical alias
// leaves the demuxer's album_artist tag intact. Deleting album_artist removes it.
for (const [assignment, expected] of [
  ["ALBUMARTIST=Second", "ALBUMARTIST=Second"],
  ["albumartist=Second", "albumartist=Second"],
  ["AlbumArtist=Second", "AlbumArtist=Second"],
  ["album_artist=Second", "ALBUMARTIST=Second"],
  ["ALBUMARTIST=", "ALBUMARTIST=First"],
  ["album_artist=", undefined]
] as const) for (const mode of ["sync", "async", "mapped"]) {
  it(`copies FLAC with ${assignment} (${mode})`, async () => {
    const volume = Volume.fromJSON({ "/in.flac": Buffer.from(input) });
    const args = ["-v", "error", "-i", "/in.flac", ...(mode === "mapped" ? ["-map", "0:a"] : []),
      "-metadata", assignment, "-c", "copy", "-f", "flac", mode === "sync" ? "/out.flac" : "pipe:1"];
    let output: Uint8Array;
    if (mode === "sync") {
      assert.equal(evalSyncFfmpeg(args, undefined, path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
      output = volume.readFileSync("/out.flac") as Buffer;
    } else {
      const chunks: Uint8Array[] = [];
      let diagnostic = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(path: string) { return volume.readFileSync(path); },
          async stat(path: string) { return volume.statSync(path); } },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { diagnostic += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, diagnostic);
      output = Buffer.concat(chunks);
    }
    const parsed = parseAudio(output);
    const records = parsed.nodes.filter(node => node.type === "VORBIS_COMMENT")
      .flatMap(node => node.fields!.comments as string[])
      .filter(record => !record.toLowerCase().startsWith("encoder="));
    assert.deepEqual(records.sort(), ["title=Keep", ...(expected === undefined ? [] : [expected])].sort());
    assert.deepEqual(parsed.nodes.find(node => node.type === "FRAMES")!.data,
      source.nodes.find(node => node.type === "FRAMES")!.data);
    assert.deepEqual(flacAst().parse(output).tracks[0]!.decodedAudio!.channelData, samples);
  });
}
