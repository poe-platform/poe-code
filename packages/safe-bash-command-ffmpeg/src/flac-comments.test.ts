import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseAudio } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FLAC audio with a Vorbis block containing repeated ARTIST entries.
const bytes = readFileSync(new URL("./fixtures/comments.flac", import.meta.url));
for (const sync of [false, true]) it(`exports FLAC Vorbis comments (${sync ? "sync" : "async"})`, async () => {
  const volume = Volume.fromJSON({ "/in.flac": bytes });
  const args = ["-v", "error", "-y", "-i", "/in.flac", "-f", "ffmetadata", "/out.txt"];
  if (sync) assert.equal(evalSyncFfmpeg(args, undefined,
    path => volume.readFileSync(path) as Buffer,
    (path, output) => { volume.writeFileSync(path, output); return true; }), "");
  else {
    let diagnostic = "";
    const result = await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, output: Uint8Array) { volume.writeFileSync(path, output); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(chunk: Uint8Array) { diagnostic += new TextDecoder().decode(chunk); } }
    } as never);
    assert.equal(result.exitCode, 0, diagnostic);
  }
  const lines = (volume.readFileSync("/out.txt", "utf8") as string).trim().split("\n");
  assert.equal(lines.shift(), ";FFMETADATA1");
  assert.deepEqual(lines.sort(), ["title=Meeting", "ARTIST=Alice\\;Bob", "album_artist=Band", "track=2", "disc=1", "comment=Notes", "encoder=Lavf61.7.100"].sort());
});

it("preserves comment values when copying FLAC audio", () => {
  let output: Uint8Array | undefined;
  assert.equal(evalSyncFfmpeg(["-v", "error", "-y", "-i", "/in.flac", "-c", "copy", "/out.flac"], undefined,
    () => bytes, (_path, value) => { output = value; return true; }), "");
  assert.ok(output);
  assert.deepEqual(parseAudio(output).tags, {
    title: "Meeting", artist: "Alice;Bob", albumArtist: "Band", track: "2", disc: "1", comment: "Notes"
  });
});
