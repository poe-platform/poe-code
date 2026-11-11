import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Expected cue text from FFmpeg 7.0.2.
const cues = [
  ["<b>one <i>two</b> three</i>", "<b>one <i>two</i></b> three"],
  ["<b>one", "<b>one</b>"],
  ["<b><i>one</i></b>", "<b><i>one</i></b>"],
  ["one</b></i></u>", "one"],
  ["<b>one <i>two <u>three</b> four</u></i>", "<b>one <i>two <u>three</u></i></b> four"],
  ["<b>one <b>two</b> three</b>", "<b>one <b>two</b> three</b>"],
  ["<i>one <b>two</i> three</b>", "<i>one <b>two</b></i> three"],
  ["<b></b>one", "<b></b>one"],
  ["<u>one\ntwo", "<u>one\ntwo</u>"],
  ["<b>one</b></b> two", "<b>one</b> two"],
  ["plain", "plain"]
] as const;

for (const sync of [false, true]) {
  for (const input of ["srt", "vtt"] as const) {
    for (const output of ["srt", "vtt"] as const) {
      for (const copy of input === output ? [false, true] : [false]) {
        it(`${sync ? "sync" : "async"} ${copy ? "copies" : "balances"} emphasis in ${input} -> ${output}`, async () => {
          const examples = input === "vtt" ? [...cues, ["<b.class>bold</b>", "bold"]] : cues;
          const serialize = (extension: string, expected: boolean) =>
            (extension === "vtt" ? "WEBVTT\n\n" : "") + examples.map((cue, index) => {
              const timing = extension === "vtt" ? "00:00.000 --> 00:01.000" : `${index + 1}\n00:00:00,000 --> 00:00:01,000`;
              const text = cue[expected ? 1 : 0]!;
              return `${timing}\n${expected && input === "vtt" && extension === "srt" ? text.replaceAll("\n", "\r\n") : text}\n`;
            }).join("\n") + (extension === "srt" ? "\n" : "");
          const source = serialize(input, false);
          const volume = Volume.fromJSON({ [`/in.${input}`]: source });
          const args = ["-v", "error", "-y", "-i", `/in.${input}`, ...(copy ? ["-c:s", "copy"] : []), `/out.${output}`];
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
          assert.equal(volume.readFileSync(`/out.${output}`, "utf8"), serialize(output, !copy));
          assert.equal(volume.readFileSync(`/in.${input}`, "utf8"), source);
        });
      }
    }
  }
}
