import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2: compare cue presence and timing independently of the final duration.
for (const sync of [false, true]) {
  for (const explicit of [false, true]) {
    for (const [tag, start] of [
      ["0:1.2", "00:01.020"],
      ["00:01.123", "00:02.230"],
      ["00:01", undefined],
      ["00:01.02", "00:01.020"]
    ] as const) {
      it(`${sync ? "sync" : "async"} reads [${tag}] as integer centiseconds (${explicit ? "explicit" : "detected"})`, async () => {
        const volume = Volume.fromJSON({ "/in.lrc": `[${tag}]line\n[00:05.00]end\n` });
        const args = ["-v", "error", ...(explicit ? ["-f", "lrc"] : []), "-i", "/in.lrc",
          "-bitexact", "-f", "webvtt", sync ? "/out.vtt" : "pipe:1"];
        let output = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          output = volume.readFileSync("/out.vtt", "utf8").toString();
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
        assert.equal(blocks.shift(), "WEBVTT");
        assert.deepEqual(blocks.slice(0, -1), start === undefined ? [] : [`${start} --> 00:05.000\nline`]);
        const last = blocks.at(-1)!.split("\n");
        assert.equal(last[0]!.split(" --> ")[0], "00:05.000");
        assert.deepEqual(last.slice(1), ["end"]);
      });
    }
  }
}
