import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { mp3Ast } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Mono fixture: native FFmpeg sine=f=440:r=44100:d=1, libmp3lame -q:a 4.
for (const fixture of ["cbr", "vbr", "mono"]) {
  for (const sync of [false, true]) {
    for (const duration of [undefined, "0.4"]) {
      it(`copies ${fixture} MP3 packets and gapless timing (${sync ? "sync" : "async"}, ${duration ?? "full"})`, async () => {
        const input = readFileSync(new URL(fixture === "mono" ? "./fixtures/copy-mono.mp3" : `../../safe-bash-command-audio/fixtures/${fixture}.mp3`, import.meta.url));
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.mp3", input);
        const args = ["-v", "error", "-y", "-i", "/in.mp3", "-c", "copy", ...(duration ? ["-t", duration] : []), "/out.mp3"];
        if (sync) {
          const result = evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
          assert.equal(result, "");
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
        const original = mp3Ast().parse(input).tracks[0]!;
        const actual = mp3Ast().parse(volume.readFileSync("/out.mp3") as Buffer).tracks[0]!;
        assert.deepEqual(actual.codecDescriptions, original.codecDescriptions);
        assert.ok(actual.samples.length > 0);
        const expected = original.samples.slice(0, actual.samples.length);
        assert.deepEqual(actual.samples.map(s => s.data), expected.map(s => s.data));
        assert.deepEqual(actual.samples.map(s => [s.skipSamples, s.discardPadding]), expected.map(s => [s.skipSamples, s.discardPadding]));
        if (!duration) assert.equal(actual.samples.length, original.samples.length);
        else if (fixture === "mono") assert.equal(actual.samples.length, 17); // Native FFmpeg -t 0.4 includes encoder delay.
      });
    }
  }
}
