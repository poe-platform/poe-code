import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const cues = [
  [String.raw`{\an8}top`, "top"],
  [String.raw`a\Nb`, "a\nb"],
  [String.raw`a\nb`, "a\nb"],
  [String.raw`{\b1}<b>bold</b>{\b0}`, "<b>bold</b>"],
  [String.raw`a{\foo}b`, "ab"],
  [String.raw`a{\an8`, "a"],
  [String.raw`{hello} a\hb`, String.raw`{hello} a\hb`],
  [String.raw`a\\Nb`, "a\\\nb"]
];
const input = cues.map(([text], index) => `${index + 1}\n00:00:01,250 --> 00:00:03,500\n${text}\n`).join("\n");

for (const sync of [false, true]) {
  for (const copy of [false, true]) {
    it(`${sync ? "sync" : "async"} ${copy ? "copies" : "transcodes"} SRT overrides and escaped line breaks`, async () => {
      const volume = Volume.fromJSON({ "/in.srt": input });
      const args = ["-y", "-v", "error", "-i", "/in.srt", ...(copy ? ["-c:s", "copy"] : []), "/out.vtt"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
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
      assert.equal(volume.readFileSync("/out.vtt", "utf8"), "WEBVTT\n\n" + cues.map(cue =>
        `00:00:01.250 --> 00:00:03.500\n${cue[copy ? 0 : 1]}\n`).join("\n"));
    });
  }
}
