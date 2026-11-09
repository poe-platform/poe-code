import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const input of ["srt", "vtt"] as const) {
    for (const copy of input === "vtt" ? [false, true] : [false]) {
      for (const [text, subrip, webvtt] of [
        ["a<00:00:01.100>b", "a<00:00:01.100>b", "ab"],
        ["<b>a<00:01.100>b</b><00:00:00.500>c", "<b>a<00:01.100>b</b><00:00:00.500>c", "<b>ab</b>c"],
        ["a<unknown at=00:01.100>b</unknown>", "ab", "ab"]
      ] as const) {
        it(`${sync ? "sync" : "async"} ${input} to WebVTT${copy ? " copy" : ""}: ${text}`, async () => {
          const serialize = (cue: string) => `WEBVTT\n\n00:00.000 --> 00:01.000\n${cue}\n`;
          const source = input === "srt"
            ? `1\n00:00:00,000 --> 00:00:01,000\n${text}\n` : serialize(text);
          const volume = Volume.fromJSON({ [`/in.${input}`]: source });
          const args = ["-v", "error", "-y", "-i", `/in.${input}`,
            ...(copy ? ["-c:s", "copy"] : []), "/out.vtt"];
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
          // Compare saved text: SubRip timestamps are literal, WebVTT timestamps are markup.
          assert.equal(volume.readFileSync("/out.vtt", "utf8"),
            serialize(copy ? text : input === "srt" ? subrip : webvtt));
          assert.equal(volume.readFileSync(`/in.${input}`, "utf8"), source);
        });
      }
    }
  }
}
