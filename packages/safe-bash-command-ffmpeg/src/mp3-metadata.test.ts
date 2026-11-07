import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseAudio } from "@poe-code/audio-ast";
import { mp3Ast, parseMp4 } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg: sine=f=440:r=44100:d=1, libmp3lame -q:a 4, title=Meeting, artist=Alice, comment=Draft.
for (const sync of [false, true]) {
  for (const extension of ["mp3", "mp4"]) {
    for (const mode of ["preserve", "override", "remove", "delete-title"]) {
      it(`${sync ? "sync" : "async"} ${mode} MP3 metadata in ${extension}`, async () => {
        const input = readFileSync(new URL("./fixtures/copy-tagged.mp3", import.meta.url));
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.mp3", input);
        const output = `/out.${extension}`;
        const args = ["-y", "-v", "error", "-i", "/in.mp3", "-c", "copy",
          ...(mode === "override" ? ["-metadata", "title=Review"] : mode === "remove" ? ["-map_metadata", "-1"]
            : mode === "delete-title" ? ["-metadata", "title="] : []), output];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer,
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
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
        }
        const bytes = volume.readFileSync(output) as Buffer;
        const tags = extension === "mp3" ? parseAudio(bytes).tags : parseMp4(bytes).metadata;
        assert.equal(tags.title, mode === "remove" || mode === "delete-title" ? undefined : mode === "override" ? "Review" : "Meeting");
        assert.equal(tags.artist, mode === "remove" ? undefined : "Alice");
        assert.equal(tags.comment, mode === "remove" ? undefined : "Draft");
        const original = mp3Ast().parse(input).tracks[0]!;
        const actual = (extension === "mp3" ? mp3Ast().parse(bytes) : parseMp4(bytes)).tracks[0]!;
        assert.deepEqual(actual.samples.map(sample => Array.from(sample.data)), original.samples.map(sample => Array.from(sample.data)));
      });
    }
  }
}
