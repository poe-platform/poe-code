import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const input of ["vtt", "srt"] as const) {
    for (const output of ["srt", "vtt"] as const) {
      for (const copy of input === output ? [false, true] : [false]) {
        it(`${sync ? "sync" : "async"} ${copy ? "copies" : "transcodes"} literal braces from ${input} to ${output}`, async () => {
          const text = "a{test}b {open and close} <b>{bold}</b>";
          const serialize = (format: string, cue: string) => format === "vtt"
            ? `WEBVTT\n\n00:00.000 --> 00:01.000\n${cue}\n`
            : `1\n00:00:00,000 --> 00:00:01,000\n${cue}\n\n`;
          const source = serialize(input, text);
          const volume = Volume.fromJSON({ [`/in.${input}`]: source });
          const args = ["-v", "error", "-y", "-i", `/in.${input}`,
            ...(copy ? ["-c:s", "copy"] : []), `/out.${output}`];
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
          // Native FFmpeg escapes WebVTT braces during decoding, but not SubRip braces.
          const expected = input === "vtt" && !copy
            ? "a\\{test\\}b \\{open and close\\} <b>\\{bold\\}</b>" : text;
          assert.equal(volume.readFileSync(`/out.${output}`, "utf8"), serialize(output, expected));
          assert.equal(volume.readFileSync(`/in.${input}`, "utf8"), source);
        });
      }
    }
  }
}
