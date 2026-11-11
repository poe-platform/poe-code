import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2 ignores labels preceding the cue chunk in these PCM WAVs.
for (const labelsFirst of [false, true]) {
  const bytes = readFileSync(new URL(
    `../../safe-bash-command-ffprobe/src/fixtures/wav-cue-order/${labelsFirst ? "labels-first" : "cues-first"}.wav`, import.meta.url
  ));
  const chapters = "[CHAPTER]\nTIMEBASE=1/8000\nSTART=0\nEND=400\n" +
    (labelsFirst ? "" : "title=Intro\n") +
    "[CHAPTER]\nTIMEBASE=1/8000\nSTART=400\nEND=800\n" +
    (labelsFirst ? "" : "title=Verse\n");
  for (const sync of [false, true]) {
    it(`exports WAV labels ${labelsFirst ? "before" : "after"} cues (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.wav": bytes });
      const args = ["-y", "-v", "error", "-i", "/in.wav", "-fflags", "+bitexact", "-f", "ffmetadata", "/out.meta"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined, path => volume.readFileSync(path) as Buffer, (path, data) => {
          volume.writeFileSync(path, data);
          return true;
        }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      assert.equal(volume.readFileSync("/out.meta", "utf8"), `;FFMETADATA1\n${chapters}`);
    });
  }
}
