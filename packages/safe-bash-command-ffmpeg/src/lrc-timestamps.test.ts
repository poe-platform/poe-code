import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2 cues before the final lyric (whose duration is unspecified).
const cases = [
  {
    input: "[00:01.00][00:03.00]Chorus\n[00:05.00]end\n",
    format: "webvtt",
    cues: ["00:01.000 --> 00:03.000\nChorus", "00:03.000 --> 00:05.000\nChorus"]
  },
  {
    input: "[00:01.00][00:03.00][00:04.00]Chorus\n[00:05.00]end\n",
    format: "srt",
    cues: ["1\n00:00:01,000 --> 00:00:03,000\nChorus", "2\n00:00:03,000 --> 00:00:04,000\nChorus",
      "3\n00:00:04,000 --> 00:00:05,000\nChorus"]
  },
  {
    input: "[00:01.00]one\n[00:05.00]end\n",
    format: "webvtt",
    cues: ["00:01.000 --> 00:05.000\none"]
  }
];

for (const sync of [false, true]) {
  for (const explicit of [false, true]) {
    for (const { input, format, cues } of cases) {
      it(`${sync ? "sync" : "async"} expands ${cues.length} LRC tags to ${format} (${explicit ? "explicit" : "detected"})`, async () => {
        const volume = Volume.fromJSON({ "/in.lrc": input });
        const args = ["-v", "error", ...(explicit ? ["-f", "lrc"] : []), "-i", "/in.lrc",
          "-bitexact", "-f", format, sync ? "/out" : "pipe:1"];
        let output = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          output = volume.readFileSync("/out", "utf8").toString();
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { output += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
        }
        const blocks = output.trim().split("\n\n");
        if (format === "webvtt") assert.equal(blocks.shift(), "WEBVTT");
        assert.equal(blocks.length, cues.length + 1);
        assert.deepEqual(blocks.slice(0, -1), cues);
        assert.equal(blocks.at(-1)!.split("\n").at(-1), "end");
      });
    }
  }
}
