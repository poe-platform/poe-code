import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const format of ["srt", "webvtt", "microdvd"]) {
    for (const [dialogue, expected] of [
      ["  one  two  ", "one  two  "],
      ["    ", ""],
      ["  \tone  two  ", "\tone  two  "],
      ["  \u00a0one  two  ", "\u00a0one  two  "],
      ["  one|  two  ", "one\n  two  "]
    ]) {
      it(`${sync ? "sync" : "async"} MicroDVD whitespace to ${format}: ${JSON.stringify(dialogue)}`, async () => {
        const input = `{10}{20}${dialogue}\n{25}{50}First\n{75}{100}Last\n`;
        const volume = Volume.fromJSON({ "/input.sub": input });
        const args = ["-v", "error", "-f", "microdvd", "-i", "/input.sub",
          ...(format === "microdvd" ? ["-c:s", "copy"] : []),
          "-f", format, sync ? "/output" : "pipe:1"];
        let stdout = "";
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
          stdout = volume.readFileSync("/output", "utf8").toString();
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
        }
        assert.equal(stdout, format === "microdvd" ? input : format === "srt"
          ? `1\n00:00:00,417 --> 00:00:00,834\n${expected!.replaceAll("\n", "\r\n")}\n\n2\n00:00:01,043 --> 00:00:02,086\nFirst\n\n3\n00:00:03,128 --> 00:00:04,171\nLast\n\n`
          : `WEBVTT\n\n00:00.417 --> 00:00.834\n${expected}\n\n00:01.043 --> 00:02.085\nFirst\n\n00:03.128 --> 00:04.171\nLast\n`);
        assert.equal(volume.readFileSync("/input.sub", "utf8"), input);
      });
    }
  }
}
